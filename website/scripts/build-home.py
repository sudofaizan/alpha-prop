#!/usr/bin/env python3
"""Build AlphaFX public landing page from saved Capiffy home export."""

import os
import re

OUT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.expanduser("~/Downloads/home page .html")

LINK_REPLACEMENTS = [
    ("https://capiffy.com/register?program=", "index.html?program="),
    ("https://capiffy.com/register?coupon=", "register.html?coupon="),
    ("https://capiffy.com/register", "register.html"),
    ("https://capiffy.com/login", "login.html"),
    ("https://capiffy.com/challenges", "index.html"),
    ("https://capiffy.com/programs", "index.html"),
    ("https://capiffy.com/rules", "rules.html"),
    ("https://capiffy.com/affiliate-program", "referrals.html"),
    ("https://capiffy.com/verify", "verification.html"),
    ("https://capiffy.com/how-it-works", "index.html"),
    ("https://capiffy.com/markets", "index.html"),
    ("https://capiffy.com/faq", "index.html#faq"),
    ("https://capiffy.com/contact", "support.html"),
    ("https://capiffy.com/about", "index.html"),
    ("https://capiffy.com/", "home.html"),
    ("https://capiffy.com/risk-disclosure", "#"),
    ("https://capiffy.com/terms", "#"),
    ("https://capiffy.com/privacy", "#"),
    ("https://capiffy.com/refund", "#"),
    ("https://capiffy.com/cookies", "#"),
    ("https://capiffy.com/aml", "#"),
]

HEAD = """<!DOCTYPE html>
<html lang="en" data-promo="on" style="--hp-scroll: 0;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0f">
  <meta name="description" content="AlphaFX — simulated funded trading accounts. Up to $200K backing, 80% profit split.">
  <title>AlphaFX — Your Edge. Our Capital.</title>
  <link rel="stylesheet" href="css/capiffy/dbe7481feefb38d2.css">
  <link rel="stylesheet" href="css/capiffy/6bc51c9a6721e22e.css">
  <link rel="stylesheet" href="css/capiffy/3ac04c147fc81d91.css">
  <link rel="stylesheet" href="css/capiffy/8ea8b8fee95c819d.css">
  <link rel="stylesheet" href="css/fonts.css">
</head>
<body data-page="home">
{content}
  <script src="js/config.js"></script>
  <script src="js/api.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/home.js?v=20260907a"></script>
</body>
</html>
"""

IMG_RE = re.compile(r'\./home page _files/(CPF-2026-\d+\.png)')


def extract_content(html: str) -> str | None:
    start = html.find('class="hp-promo"')
    if start < 0:
        return None
    start = html.rfind("<div", 0, start)
    footer_start = html.find('<footer class="hp-footer"')
    footer_end = html.find("</footer>", footer_start)
    if footer_start < 0 or footer_end < 0:
        return None
    return html[start : footer_end + 9].strip()


def transform(content: str) -> str:
    content = IMG_RE.sub(r"img/home/\1", content)
    for old, new in LINK_REPLACEMENTS:
        content = content.replace(old, new)
    content = content.replace("CAPIFFY", "ALPHAFX")
    content = content.replace("Capiffy", "AlphaFX")
    content = content.replace("CPF-2026", "AFX-2026")
    content = content.replace("OFF32", "ALPHA38")
    content = re.sub(r'href="home\.html"', 'href="/"', content)
    return content


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f"Missing source: {SRC}")
    html = open(SRC, encoding="utf-8").read()
    content = extract_content(html)
    if not content:
        raise SystemExit("Could not extract landing page content")
    content = transform(content)
    out_path = os.path.join(OUT, "home.html")
    open(out_path, "w", encoding="utf-8").write(HEAD.format(content=content))
    print(f"built home.html ({len(content)} bytes)")


if __name__ == "__main__":
    main()
