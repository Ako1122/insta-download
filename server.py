"""
Instagram 影片/照片下載器 - Flask 後端
免 Cookie 版本：使用多種方法解析，使用者不需要提供任何登入資訊
"""

import re
import json
import requests
from flask import Flask, render_template, jsonify, request, Response

app = Flask(__name__)


class InstagramDownloader:
    """Instagram 媒體解析器（免 Cookie 版）"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/17.0 Mobile/15E148 Safari/604.1"
                ),
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )

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
    # 方法 1：GraphQL（不需要 Cookie 的端點）
    # ============================================================
    def fetch_by_graphql(self, shortcode: str) -> dict | None:
        """使用 Instagram 公開 GraphQL 端點"""
        url = "https://www.instagram.com/graphql/query/"

        # 多個 doc_id，Instagram 會定期更換，保留多個備用
        doc_ids = [
            "8845758582119845",
            "9510064595728286",
            "7153639394707040",
            "6489621044466986",
        ]

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.instagram.com/",
            "Origin": "https://www.instagram.com",
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
    # 方法 2：Instagram oEmbed API（完全公開，不需要 Cookie）
    # ============================================================
    def fetch_by_oembed(self, shortcode: str) -> dict | None:
        """使用 Instagram 的 oEmbed API 取得基本資訊"""
        try:
            post_url = f"https://www.instagram.com/p/{shortcode}/"
            oembed_url = "https://api.instagram.com/oembed/"
            params = {
                "url": post_url,
                "omitscript": "true",
            }
            resp = self.session.get(oembed_url, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                # oEmbed 回傳的資料有限，但可以取得縮圖和作者
                result = {
                    "type": "image",
                    "caption": data.get("title", ""),
                    "author": data.get("author_name", ""),
                    "thumbnail": data.get("thumbnail_url", ""),
                    "medias": [],
                }
                if data.get("thumbnail_url"):
                    result["medias"].append(
                        {
                            "type": "image",
                            "url": data["thumbnail_url"],
                            "quality": "縮圖畫質",
                        }
                    )
                return result if result["medias"] else None
        except Exception:
            pass
        return None

    # ============================================================
    # 方法 3：解析頁面 HTML + JSON-LD
    # ============================================================
    def fetch_by_page(self, shortcode: str) -> dict | None:
        """解析 Instagram 頁面中的嵌入資料"""
        try:
            url = f"https://www.instagram.com/p/{shortcode}/"
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            }
            resp = self.session.get(url, headers=headers, timeout=15)
            html = resp.text

            # 嘗試 1：從 JSON-LD 提取
            ld_match = re.search(
                r'<script type="application/ld\+json">\s*({.+?})\s*</script>',
                html,
                re.DOTALL,
            )
            if ld_match:
                try:
                    ld_data = json.loads(ld_match.group(1))
                    if ld_data.get("video"):
                        video_url = (
                            ld_data["video"][0].get("contentUrl", "")
                            if isinstance(ld_data["video"], list)
                            else ld_data["video"].get("contentUrl", "")
                        )
                        if video_url:
                            return {
                                "type": "video",
                                "caption": ld_data.get("articleBody", ""),
                                "author": ld_data.get("author", {}).get("name", ""),
                                "thumbnail": ld_data.get("thumbnailUrl", ""),
                                "medias": [
                                    {
                                        "type": "video",
                                        "url": video_url,
                                        "quality": "原始畫質",
                                    }
                                ],
                            }
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass

            # 嘗試 2：直接搜尋 video_url
            video_match = re.search(r'"video_url":"([^"]+)"', html)
            if video_match:
                video_url = video_match.group(1).encode().decode("unicode_escape")
                return {
                    "type": "video",
                    "caption": "",
                    "author": "",
                    "thumbnail": "",
                    "medias": [
                        {
                            "type": "video",
                            "url": video_url,
                            "quality": "原始畫質",
                        }
                    ],
                }

            # 嘗試 3：搜尋 display_url（圖片）
            image_match = re.search(r'"display_url":"([^"]+)"', html)
            if image_match:
                image_url = image_match.group(1).encode().decode("unicode_escape")
                return {
                    "type": "image",
                    "caption": "",
                    "author": "",
                    "thumbnail": "",
                    "medias": [
                        {
                            "type": "image",
                            "url": image_url,
                            "quality": "原始畫質",
                        }
                    ],
                }

        except Exception:
            pass
        return None

    # ============================================================
    # 方法 4：使用第三方公開 API 作為備援
    # ============================================================
    def fetch_by_third_party(self, shortcode: str) -> dict | None:
        """使用第三方公開 API 服務作為備援"""
        apis = [
            {
                "name": "saveig",
                "url": f"https://www.saveig.app/api/ajaxSearch",
                "method": "POST",
                "data": {
                    "q": f"https://www.instagram.com/p/{shortcode}/",
                    "lang": "en",
                },
            },
        ]

        for api in apis:
            try:
                if api["method"] == "POST":
                    resp = self.session.post(
                        api["url"],
                        data=api.get("data", {}),
                        timeout=15,
                    )
                else:
                    resp = self.session.get(
                        api["url"],
                        params=api.get("params", {}),
                        timeout=15,
                    )

                if resp.status_code == 200:
                    data = (
                        resp.json()
                        if "json" in resp.headers.get("Content-Type", "")
                        else {}
                    )
                    # 從 HTML 回應中提取下載連結
                    html_content = data.get("data", resp.text)
                    video_urls = re.findall(
                        r'href="(https://[^"]*cdninstagram\.com[^"]*)"',
                        str(html_content),
                    )
                    if video_urls:
                        medias = []
                        for i, url in enumerate(set(video_urls)):
                            media_type = "video" if ".mp4" in url else "image"
                            medias.append(
                                {
                                    "type": media_type,
                                    "url": url,
                                    "quality": "原始畫質",
                                    "index": i + 1,
                                }
                            )
                        return {
                            "type": medias[0]["type"],
                            "caption": "",
                            "author": "",
                            "thumbnail": "",
                            "medias": medias,
                        }
            except Exception:
                continue
        return None

    # ============================================================
    # 解析媒體資料結構
    # ============================================================
    def _parse_media(self, media: dict) -> dict:
        """解析 Instagram GraphQL 媒體資料"""
        result = {
            "type": "unknown",
            "caption": "",
            "author": "",
            "thumbnail": "",
            "medias": [],
        }

        # 取得貼文資訊
        caption_edges = media.get("edge_media_to_caption", {}).get("edges", [])
        if caption_edges:
            result["caption"] = caption_edges[0].get("node", {}).get("text", "")

        owner = media.get("owner", {})
        result["author"] = owner.get("username", "")
        result["thumbnail"] = media.get("display_url", "")

        typename = media.get("__typename", "")

        # 輪播貼文（多張圖片/影片）
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
            # 不同畫質版本
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
        """依序嘗試多種免 Cookie 解析方式"""
        shortcode = self.extract_shortcode(url)
        if not shortcode:
            return {"success": False, "error": "無效的 Instagram 網址"}

        methods = [
            ("GraphQL API", self.fetch_by_graphql),
            ("Page Parser", self.fetch_by_page),
            ("oEmbed API", self.fetch_by_oembed),
            ("Third Party", self.fetch_by_third_party),
        ]

        for method_name, method_func in methods:
            try:
                result = method_func(shortcode)
                if result and result.get("medias"):
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


# 建立全域下載器實例
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
    """代理下載（解決跨域和 Referer 問題）"""
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

        # 根據 Content-Type 決定副檔名
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        ext = "mp4" if "video" in content_type else "jpg"

        headers = {
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="instagram_download.{ext}"',
        }
        return Response(resp.iter_content(chunk_size=8192), headers=headers)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# 啟動伺服器
# ============================================================

if __name__ == "__main__":
    import os

    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Instagram 下載器已啟動（免 Cookie 版）")
    print(f"📍 http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
