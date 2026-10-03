"""
Instagram 影片/照片下載器 - Flask 後端
代理版：透過多個第三方服務解析，不需要自己維護 Instagram session
"""

import re
import json
import requests
from flask import Flask, render_template, jsonify, request, Response

app = Flask(__name__)


class InstagramDownloader:
    """Instagram 媒體解析器（代理多個第三方服務）"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
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

    def normalize_url(self, url: str) -> str:
        """標準化 Instagram 網址"""
        shortcode = self.extract_shortcode(url)
        if shortcode:
            return f"https://www.instagram.com/p/{shortcode}/"
        return url

    # ============================================================
    # 方法 1：SaveInsta API
    # ============================================================
    def fetch_via_saveinsta(self, url: str) -> dict | None:
        try:
            # 第一步：取得頁面 token
            page_resp = self.session.get("https://saveinsta.app/en", timeout=10)
            token_match = re.search(r'name="token"\s+value="([^"]+)"', page_resp.text)
            token = token_match.group(1) if token_match else ""

            api_url = "https://saveinsta.app/api/ajaxSearch"
            data = {
                "q": url,
                "lang": "en",
                "t": "media",
                "token": token,
            }
            headers = {
                "Referer": "https://saveinsta.app/en",
                "Origin": "https://saveinsta.app",
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
            }
            resp = self.session.post(api_url, data=data, headers=headers, timeout=15)

            if resp.status_code == 200:
                result_data = resp.json()
                html_content = result_data.get("data", "")
                return self._parse_html_response(html_content)
        except Exception:
            pass
        return None

    # ============================================================
    # 方法 2：SaveFrom 風格 API
    # ============================================================
    def fetch_via_savefrom(self, url: str) -> dict | None:
        try:
            api_url = "https://api.savefrom.biz/api/convert"
            data = {
                "url": url,
            }
            headers = {
                "Content-Type": "application/json",
                "Origin": "https://savefrom.biz",
                "Referer": "https://savefrom.biz/",
            }
            resp = self.session.post(api_url, json=data, headers=headers, timeout=15)

            if resp.status_code == 200:
                result_data = resp.json()
                return self._parse_api_response(result_data)
        except Exception:
            pass
        return None

    # ============================================================
    # 方法 3：SnapInsta 風格 API
    # ============================================================
    def fetch_via_snapinsta(self, url: str) -> dict | None:
        try:
            # 取得頁面 token
            page_resp = self.session.get("https://snapinsta.app/en", timeout=10)
            token_match = re.search(r'name="token"\s+value="([^"]+)"', page_resp.text)
            token = token_match.group(1) if token_match else ""

            api_url = "https://snapinsta.app/api/ajaxSearch"
            data = {
                "q": url,
                "lang": "en",
                "t": "media",
                "token": token,
            }
            headers = {
                "Referer": "https://snapinsta.app/en",
                "Origin": "https://snapinsta.app",
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
            }
            resp = self.session.post(api_url, data=data, headers=headers, timeout=15)

            if resp.status_code == 200:
                result_data = resp.json()
                html_content = result_data.get("data", "")
                return self._parse_html_response(html_content)
        except Exception:
            pass
        return None

    # ============================================================
    # 方法 4：FastSaver API
    # ============================================================
    def fetch_via_fastsaver(self, url: str) -> dict | None:
        try:
            api_url = "https://api.fastsaver.io/api/v1/fetch"
            data = {"url": url}
            headers = {
                "Content-Type": "application/json",
                "Origin": "https://fastsaverapi.com",
                "Referer": "https://fastsaverapi.com/",
            }
            resp = self.session.post(api_url, json=data, headers=headers, timeout=15)

            if resp.status_code == 200:
                result_data = resp.json()
                return self._parse_fastsaver_response(result_data)
        except Exception:
            pass
        return None

    # ============================================================
    # 解析回應
    # ============================================================
    def _parse_html_response(self, html: str) -> dict | None:
        """解析第三方服務回傳的 HTML 格式回應"""
        if not html:
            return None

        result = {
            "type": "unknown",
            "caption": "",
            "author": "",
            "thumbnail": "",
            "medias": [],
        }

        # 提取所有下載連結
        download_links = re.findall(
            r'href="(https?://[^"]*)"[^>]*>.*?(?:Download|下載)',
            html,
            re.DOTALL | re.IGNORECASE,
        )

        # 也搜尋 data-url 或 src 屬性中的 CDN 連結
        cdn_links = re.findall(
            r'(?:href|src|data-url)="(https?://[^"]*(?:cdninstagram|fbcdn)[^"]*)"',
            html,
            re.IGNORECASE,
        )

        all_links = list(set(download_links + cdn_links))

        # 提取縮圖
        thumb_match = re.search(
            r'<img[^>]+src="(https?://[^"]*(?:cdninstagram|fbcdn)[^"]*)"', html
        )
        if thumb_match:
            result["thumbnail"] = thumb_match.group(1)

        seen = set()
        for link in all_links:
            if link in seen:
                continue
            seen.add(link)

            if ".mp4" in link or "video" in link.lower():
                result["medias"].append(
                    {
                        "type": "video",
                        "url": link,
                        "quality": "原始畫質",
                    }
                )
            elif any(
                ext in link
                for ext in [".jpg", ".png", ".webp", "cdninstagram", "fbcdn"]
            ):
                result["medias"].append(
                    {
                        "type": "image",
                        "url": link,
                        "quality": "原始畫質",
                    }
                )

        if result["medias"]:
            result["type"] = result["medias"][0]["type"]
            if len(result["medias"]) > 1:
                result["type"] = "carousel"
                for i, m in enumerate(result["medias"]):
                    m["index"] = i + 1
            return result

        return None

    def _parse_api_response(self, data: dict) -> dict | None:
        """解析 JSON 格式的 API 回應"""
        if not data:
            return None

        result = {
            "type": "unknown",
            "caption": "",
            "author": "",
            "thumbnail": "",
            "medias": [],
        }

        # 通用格式：urls 陣列
        urls = data.get("urls", data.get("medias", data.get("url", [])))
        if isinstance(urls, str):
            urls = [{"url": urls}]
        elif isinstance(urls, dict):
            urls = [urls]

        for item in urls:
            if isinstance(item, str):
                item = {"url": item}
            url = item.get("url", "")
            if not url:
                continue

            media_type = (
                "video" if (".mp4" in url or item.get("type") == "video") else "image"
            )
            quality = item.get("quality", item.get("resolution", "原始畫質"))

            result["medias"].append(
                {
                    "type": media_type,
                    "url": url,
                    "quality": str(quality),
                }
            )

        result["thumbnail"] = data.get("thumbnail", data.get("thumb", ""))
        result["author"] = data.get("author", data.get("username", ""))
        result["caption"] = data.get("caption", data.get("title", ""))

        if result["medias"]:
            result["type"] = result["medias"][0]["type"]
            if len(result["medias"]) > 1:
                result["type"] = "carousel"
                for i, m in enumerate(result["medias"]):
                    m["index"] = i + 1
            return result

        return None

    def _parse_fastsaver_response(self, data: dict) -> dict | None:
        """解析 FastSaver API 回應"""
        if not data or not data.get("result"):
            return None

        result = {
            "type": "unknown",
            "caption": "",
            "author": "",
            "thumbnail": "",
            "medias": [],
        }

        items = data.get("result", [])
        if isinstance(items, dict):
            items = [items]

        for item in items:
            url = item.get("url", item.get("download_url", ""))
            if not url:
                continue

            media_type = item.get("type", "image")
            if ".mp4" in url or "video" in str(item.get("type", "")):
                media_type = "video"

            result["medias"].append(
                {
                    "type": media_type,
                    "url": url,
                    "quality": item.get("quality", "原始畫質"),
                }
            )

        result["thumbnail"] = data.get("thumbnail", "")
        result["author"] = data.get("username", "")

        if result["medias"]:
            result["type"] = result["medias"][0]["type"]
            if len(result["medias"]) > 1:
                result["type"] = "carousel"
                for i, m in enumerate(result["medias"]):
                    m["index"] = i + 1
            return result

        return None

    # ============================================================
    # 主要下載方法
    # ============================================================
    def download(self, url: str) -> dict:
        shortcode = self.extract_shortcode(url)
        if not shortcode:
            return {"success": False, "error": "無效的 Instagram 網址"}

        clean_url = self.normalize_url(url)

        # 依序嘗試多個第三方服務
        methods = [
            ("SaveInsta", self.fetch_via_saveinsta),
            ("SnapInsta", self.fetch_via_snapinsta),
            ("FastSaver", self.fetch_via_fastsaver),
            ("SaveFrom", self.fetch_via_savefrom),
        ]

        for method_name, method_func in methods:
            try:
                result = method_func(clean_url)
                if result and result.get("medias"):
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
            "error": "所有解析服務暫時無法使用，請稍後再試",
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
    print("🚀 Instagram 下載器已啟動（代理版）")
    print(f"📍 http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
