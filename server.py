"""
Instagram 影片/照片下載器 - Flask 後端
2026 最新版：使用 data-sjs 嵌入 JSON + 多重備援方法
"""

import re
import json
import requests
from flask import Flask, render_template, jsonify, request, Response

app = Flask(__name__)


class InstagramDownloader:
    """Instagram 媒體解析器（2026 最新版）"""

    def __init__(self):
        self.session = requests.Session()
        # 模擬真實瀏覽器
        self.browser_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }

    def extract_shortcode(self, url: str) -> str | None:
        """從 Instagram 網址中提取 shortcode"""
        patterns = [
            r"instagram\.com/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)",
            r"instagr\.am/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    # ============================================================
    # 方法 1：解析頁面中的 data-sjs JSON（2026 最新方法）
    # ============================================================
    def fetch_by_data_sjs(self, shortcode: str) -> dict | None:
        """
        2026 年 Instagram 把貼文資料藏在
        <script type="application/json" data-sjs> 標籤裡
        """
        try:
            url = f"https://www.instagram.com/p/{shortcode}/"
            resp = self.session.get(url, headers=self.browser_headers, timeout=20)
            html = resp.text

            # 提取所有 data-sjs 的 JSON 區塊
            sjs_blocks = re.findall(
                r'<script\s+type="application/json"\s+data-sjs[^>]*>\s*({.+?})\s*</script>',
                html,
                re.DOTALL,
            )

            for block in sjs_blocks:
                try:
                    data = json.loads(block)
                    # 遞迴搜尋含有 shortcode_media 或 xdt_shortcode_media 的資料
                    media = self._deep_search(data, shortcode)
                    if media:
                        return self._parse_media(media)
                except (json.JSONDecodeError, RecursionError):
                    continue

        except Exception:
            pass
        return None

    def _deep_search(self, obj, shortcode, depth=0):
        """遞迴搜尋 JSON 中的媒體資料"""
        if depth > 15:
            return None

        if isinstance(obj, dict):
            # 找到目標
            if obj.get("shortcode") == shortcode and (
                obj.get("video_url")
                or obj.get("display_url")
                or obj.get("edge_sidecar_to_children")
            ):
                return obj

            # 檢查常見的 key
            for key in [
                "xdt_shortcode_media",
                "shortcode_media",
                "xdt_api__v1__media__shortcode__web_info",
                "media",
                "data",
                "result",
                "graphql",
            ]:
                if key in obj:
                    result = self._deep_search(obj[key], shortcode, depth + 1)
                    if result:
                        return result

            # 搜尋所有值
            for value in obj.values():
                if isinstance(value, (dict, list)):
                    result = self._deep_search(value, shortcode, depth + 1)
                    if result:
                        return result

        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    result = self._deep_search(item, shortcode, depth + 1)
                    if result:
                        return result

        return None

    # ============================================================
    # 方法 2：直接搜尋 HTML 中的 video_url / display_url
    # ============================================================
    def fetch_by_regex(self, shortcode: str) -> dict | None:
        """用正則表達式直接從 HTML 中搜尋媒體網址"""
        try:
            url = f"https://www.instagram.com/p/{shortcode}/"
            resp = self.session.get(url, headers=self.browser_headers, timeout=20)
            html = resp.text

            result = {
                "type": "unknown",
                "caption": "",
                "author": "",
                "thumbnail": "",
                "medias": [],
            }

            # 搜尋所有 video_url
            video_urls = re.findall(r'"video_url":"([^"]+)"', html)
            for v_url in video_urls:
                decoded = v_url.encode().decode("unicode_escape")
                if decoded not in [m["url"] for m in result["medias"]]:
                    result["medias"].append(
                        {
                            "type": "video",
                            "url": decoded,
                            "quality": "原始畫質",
                        }
                    )

            # 如果沒有影片，搜尋 display_url（圖片）
            if not result["medias"]:
                image_urls = re.findall(r'"display_url":"([^"]+)"', html)
                seen = set()
                for i_url in image_urls:
                    decoded = i_url.encode().decode("unicode_escape")
                    if decoded not in seen and "cdninstagram.com" in decoded:
                        seen.add(decoded)
                        result["medias"].append(
                            {
                                "type": "image",
                                "url": decoded,
                                "quality": "原始畫質",
                            }
                        )

            if result["medias"]:
                result["type"] = result["medias"][0]["type"]
                return result

        except Exception:
            pass
        return None

    # ============================================================
    # 方法 3：GraphQL（備援）
    # ============================================================
    def fetch_by_graphql(self, shortcode: str) -> dict | None:
        """使用 GraphQL 端點"""
        url = "https://www.instagram.com/graphql/query/"
        doc_ids = [
            "8845758582119845",
            "9510064595728286",
            "7153639394707040",
            "6489621044466986",
        ]

        headers = {
            **self.browser_headers,
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.instagram.com/",
            "Origin": "https://www.instagram.com",
            "Accept": "*/*",
        }

        for doc_id in doc_ids:
            try:
                params = {
                    "doc_id": doc_id,
                    "variables": json.dumps(
                        {
                            "shortcode": shortcode,
                            "fetch_tagged_user_count": None,
                            "hoisted_comment_id": None,
                            "hoisted_reply_id": None,
                        }
                    ),
                }
                resp = self.session.get(url, params=params, headers=headers, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    media = data.get("data", {}).get("xdt_shortcode_media") or data.get(
                        "data", {}
                    ).get("shortcode_media")
                    if media:
                        return self._parse_media(media)
            except Exception:
                continue
        return None

    # ============================================================
    # 方法 4：使用 Instagram Embed 端點
    # ============================================================
    def fetch_by_embed(self, shortcode: str) -> dict | None:
        """透過 Instagram 的 embed 端點取得資料"""
        try:
            url = f"https://www.instagram.com/p/{shortcode}/embed/"
            headers = {
                **self.browser_headers,
                "Referer": "https://www.instagram.com/",
            }
            resp = self.session.get(url, headers=headers, timeout=15)
            html = resp.text

            result = {
                "type": "unknown",
                "caption": "",
                "author": "",
                "thumbnail": "",
                "medias": [],
            }

            # 從 embed 頁面提取影片
            video_urls = re.findall(r'"video_url":"([^"]+)"', html)
            if not video_urls:
                video_urls = re.findall(r'<source\s+src="([^"]+)"', html)

            for v_url in video_urls:
                decoded = (
                    v_url.encode().decode("unicode_escape") if "\\u" in v_url else v_url
                )
                result["medias"].append(
                    {
                        "type": "video",
                        "url": decoded,
                        "quality": "原始畫質",
                    }
                )

            # 從 embed 頁面提取圖片
            if not result["medias"]:
                # 高畫質圖片
                img_urls = re.findall(
                    r'class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"', html
                )
                if not img_urls:
                    img_urls = re.findall(
                        r'<img[^>]+src="(https://[^"]*cdninstagram\.com[^"]*)"', html
                    )
                seen = set()
                for i_url in img_urls:
                    decoded = (
                        i_url.encode().decode("unicode_escape")
                        if "\\u" in i_url
                        else i_url
                    )
                    if decoded not in seen:
                        seen.add(decoded)
                        result["medias"].append(
                            {
                                "type": "image",
                                "url": decoded,
                                "quality": "原始畫質",
                            }
                        )

            if result["medias"]:
                result["type"] = result["medias"][0]["type"]
                # 嘗試取得作者
                author_match = re.search(r'"username":"([^"]+)"', html)
                if author_match:
                    result["author"] = author_match.group(1)
                return result

        except Exception:
            pass
        return None

    # ============================================================
    # 解析 GraphQL 媒體資料結構
    # ============================================================
    def _parse_media(self, media: dict) -> dict:
        result = {
            "type": "unknown",
            "caption": "",
            "author": "",
            "thumbnail": "",
            "medias": [],
        }

        caption_edges = media.get("edge_media_to_caption", {}).get("edges", [])
        if caption_edges:
            result["caption"] = caption_edges[0].get("node", {}).get("text", "")

        # caption 也可能在 caption.text
        if not result["caption"]:
            cap = media.get("caption", {})
            if isinstance(cap, dict):
                result["caption"] = cap.get("text", "")

        owner = media.get("owner", {})
        result["author"] = owner.get("username", "")
        result["thumbnail"] = media.get("display_url", "")

        typename = media.get("__typename", "")

        # 輪播貼文
        if typename == "GraphSidecar" or media.get("edge_sidecar_to_children"):
            result["type"] = "carousel"
            edges = media.get("edge_sidecar_to_children", {}).get("edges", [])
            for i, edge in enumerate(edges):
                node = edge.get("node", {})
                if node.get("is_video"):
                    result["medias"].append(
                        {
                            "type": "video",
                            "url": node.get("video_url", ""),
                            "thumbnail": node.get("display_url", ""),
                            "quality": "原始畫質",
                            "index": i + 1,
                        }
                    )
                else:
                    result["medias"].append(
                        {
                            "type": "image",
                            "url": node.get("display_url", ""),
                            "quality": "原始畫質",
                            "index": i + 1,
                        }
                    )

        # 單一影片
        elif media.get("is_video") or typename in ("GraphVideo", "XDTGraphVideo"):
            result["type"] = "video"
            result["medias"].append(
                {
                    "type": "video",
                    "url": media.get("video_url", ""),
                    "thumbnail": media.get("display_url", ""),
                    "quality": "原始畫質",
                }
            )
            for v in media.get("video_versions", []):
                result["medias"].append(
                    {
                        "type": "video",
                        "url": v.get("url", ""),
                        "quality": f"{v.get('width', '?')}x{v.get('height', '?')}",
                    }
                )

        # 單一圖片
        else:
            result["type"] = "image"
            result["medias"].append(
                {
                    "type": "image",
                    "url": media.get("display_url", ""),
                    "quality": "原始畫質",
                }
            )

        return result

    # ============================================================
    # 主要下載方法
    # ============================================================
    def download(self, url: str) -> dict:
        shortcode = self.extract_shortcode(url)
        if not shortcode:
            return {"success": False, "error": "無效的 Instagram 網址"}

        # 2026 最新解析順序
        methods = [
            ("data-sjs 解析", self.fetch_by_data_sjs),
            ("HTML 正則解析", self.fetch_by_regex),
            ("Embed 頁面", self.fetch_by_embed),
            ("GraphQL API", self.fetch_by_graphql),
        ]

        for method_name, method_func in methods:
            try:
                result = method_func(shortcode)
                if result and result.get("medias"):
                    # 過濾掉空的 url
                    result["medias"] = [m for m in result["medias"] if m.get("url")]
                    if result["medias"]:
                        return {
                            "success": True,
                            "method": method_name,
                            "shortcode": shortcode,
                            **result,
                        }
            except Exception:
                continue

        return {
            "success": False,
            "error": "無法解析此貼文，Instagram 可能暫時封鎖了請求，請稍後再試",
        }


downloader = InstagramDownloader()


# ============================================================
# Flask 路由
# ============================================================


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/parse", methods=["POST"])
def parse_url():
    data = request.get_json()
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"success": False, "error": "請輸入網址"}), 400

    if "instagram.com" not in url and "instagr.am" not in url:
        return jsonify({"success": False, "error": "請輸入有效的 Instagram 網址"}), 400

    result = downloader.download(url)
    return jsonify(result)


@app.route("/api/proxy", methods=["GET"])
def proxy_download():
    """代理下載"""
    media_url = request.args.get("url", "")
    if not media_url:
        return jsonify({"error": "缺少下載網址"}), 400

    try:
        resp = requests.get(
            media_url,
            stream=True,
            timeout=30,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.instagram.com/",
            },
        )
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        ext = "mp4" if "video" in content_type else "jpg"
        headers = {
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="instagram_download.{ext}"',
        }
        return Response(resp.iter_content(chunk_size=8192), headers=headers)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Instagram 下載器已啟動（2026 最新版）")
    print(f"📍 http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
