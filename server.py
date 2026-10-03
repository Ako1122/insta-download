"""
Instagram 影片/照片下載器 - Flask 後端
"""

import re
import json
import requests
from flask import Flask, render_template, jsonify, request
from urllib.parse import quote

app = Flask(__name__)

# ============================================================
# Instagram 解析核心邏輯
# ============================================================


class InstagramDownloader:
    """Instagram 媒體解析器"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "*/*",
                "Origin": "https://www.instagram.com",
                "Referer": "https://www.instagram.com/",
                "X-IG-App-ID": "936619743392459",
                "X-Requested-With": "XMLHttpRequest",
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

    def fetch_by_graphql(self, shortcode: str) -> dict | None:
        """方法 1：透過 GraphQL API 取得媒體資訊"""
        url = "https://www.instagram.com/graphql/query/"

        # 嘗試多個已知的 doc_id（Instagram 會定期更換）
        doc_ids = [
            "8845758582119845",
            "9510064595728286",
            "7153639394707040",
        ]

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
                resp = self.session.get(url, params=params, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    # 嘗試不同的回應結構
                    media = data.get("data", {}).get("xdt_shortcode_media") or data.get(
                        "data", {}
                    ).get("shortcode_media")
                    if media:
                        return self._parse_media(media)
            except Exception:
                continue
        return None

    def fetch_by_page(self, shortcode: str) -> dict | None:
        """方法 2：透過解析頁面 HTML 取得媒體資訊"""
        try:
            url = f"https://www.instagram.com/p/{shortcode}/"
            resp = self.session.get(url, timeout=15)
            html = resp.text

            # 嘗試從 script 標籤中提取 JSON 資料
            # 方式 A：尋找 window._sharedData
            shared_data_match = re.search(
                r"window\._sharedData\s*=\s*({.+?});</script>", html
            )
            if shared_data_match:
                data = json.loads(shared_data_match.group(1))
                media = (
                    data.get("entry_data", {})
                    .get("PostPage", [{}])[0]
                    .get("graphql", {})
                    .get("shortcode_media")
                )
                if media:
                    return self._parse_media(media)

            # 方式 B：尋找 __additionalDataLoaded
            additional_match = re.search(
                r'window\.__additionalDataLoaded\s*\(\s*[\'"][^\'"]+[\'"]\s*,\s*({.+?})\s*\)\s*;',
                html,
            )
            if additional_match:
                data = json.loads(additional_match.group(1))
                media = data.get("graphql", {}).get("shortcode_media")
                if media:
                    return self._parse_media(media)

            # 方式 C：直接用正則表達式搜尋 video_url
            video_match = re.search(r'"video_url":"([^"]+)"', html)
            if video_match:
                video_url = video_match.group(1).encode().decode("unicode_escape")
                return {
                    "type": "video",
                    "medias": [
                        {
                            "type": "video",
                            "url": video_url,
                            "quality": "原始畫質",
                        }
                    ],
                }

        except Exception:
            pass
        return None

    def fetch_by_api_endpoint(self, shortcode: str) -> dict | None:
        """方法 3：透過 Instagram 的 media endpoint"""
        try:
            url = f"https://www.instagram.com/p/{shortcode}/?__a=1&__d=dis"
            resp = self.session.get(url, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                media = data.get("graphql", {}).get("shortcode_media")
                if not media:
                    media = data.get("items", [{}])[0] if data.get("items") else None
                if media:
                    return self._parse_media(media)
        except Exception:
            pass
        return None

    def _parse_media(self, media: dict) -> dict:
        """解析 Instagram 媒體資料結構"""
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
        elif (
            media.get("is_video")
            or typename == "GraphVideo"
            or typename == "XDTGraphVideo"
        ):
            result["type"] = "video"
            video_url = media.get("video_url", "")
            result["medias"].append(
                {
                    "type": "video",
                    "url": video_url,
                    "thumbnail": media.get("display_url", ""),
                    "quality": "原始畫質",
                }
            )
            # 嘗試取得不同畫質版本
            video_versions = media.get("video_versions", [])
            for v in video_versions:
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

    def download(self, url: str) -> dict:
        """主要下載方法：依序嘗試多種解析方式"""
        shortcode = self.extract_shortcode(url)
        if not shortcode:
            return {"success": False, "error": "無效的 Instagram 網址"}

        # 依序嘗試三種方法
        methods = [
            ("GraphQL API", self.fetch_by_graphql),
            ("Page Parser", self.fetch_by_page),
            ("API Endpoint", self.fetch_by_api_endpoint),
        ]

        for method_name, method_func in methods:
            result = method_func(shortcode)
            if result and result.get("medias"):
                return {
                    "success": True,
                    "method": method_name,
                    "shortcode": shortcode,
                    **result,
                }

        return {
            "success": False,
            "error": "無法解析此貼文，可能需要登入或貼文已被刪除",
        }


# 建立全域下載器實例
downloader = InstagramDownloader()


# ============================================================
# Flask 路由
# ============================================================


@app.route("/")
def index():
    """首頁"""
    return render_template("index.html")


@app.route("/api/parse", methods=["POST"])
def parse_url():
    """解析 Instagram 網址 API"""
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
    """代理下載（避免跨域問題）"""
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
            },
        )
        from flask import Response

        headers = {
            "Content-Type": resp.headers.get(
                "Content-Type", "application/octet-stream"
            ),
            "Content-Disposition": 'attachment; filename="instagram_media"',
        }
        return Response(resp.iter_content(chunk_size=8192), headers=headers)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# 啟動伺服器
# ============================================================

if __name__ == "__main__":
    print("🚀 Instagram 下載器已啟動")
    print("📍 請在瀏覽器中開啟 http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
