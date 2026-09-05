#!/usr/bin/env python3
"""Rebuild AlphaFX portal pages from saved Capiffy HTML exports in ~/Downloads."""

import re
import os
import glob

OUT = os.path.join(os.path.dirname(__file__), "..")
DL = os.path.expanduser("~/Downloads")

PAGES = [
    ("chalanges.html", "index.html", "challenges", "Challenges — AlphaFX", "Challenges"),
    # Dynamic API-driven pages — do not rebuild from Capiffy:
    # accounts.html, dashboard.html, billing.html, notifications.html, account-statistics.html, profile.html
    ("payout.html", "payouts.html", "payouts", "Payouts — AlphaFX", "Payouts"),
    ("leaderboard.html", "leaderboard.html", "leaderboard", "Leaderboard — AlphaFX", "Leaderboard"),
    ("rules.html", "rules.html", "rules", "Rules — AlphaFX", "Rules"),
    ("verification.html", "verification.html", "verification", "Verification — AlphaFX", "Verification"),
    ("certificates.html", "certificates.html", "certificates", "Certificates — AlphaFX", "Certificates"),
    ("referels.html", "referrals.html", "referrals", "Referrals — AlphaFX", "Referrals"),
]

EXTRA_SCRIPTS = {
    "index.html": [
        '  <script src="js/config.js"></script>',
        '  <script src="js/api.js"></script>',
        '  <script src="js/auth.js"></script>',
        '  <script src="js/challenges.js"></script>',
    ],
}

LINK_REPLACEMENTS = [
    ("https://capiffy.com/dashboard/payouts", "payouts.html"),
    ("https://capiffy.com/dashboard/billing", "billing.html"),
    ("https://capiffy.com/dashboard/notifications", "notifications.html"),
    ("https://capiffy.com/dashboard/certificates", "certificates.html"),
    ("https://capiffy.com/dashboard/profile", "profile.html"),
    ("https://capiffy.com/dashboard/support", "support.html"),
    ("https://capiffy.com/dashboard/rules", "rules.html"),
    ("https://capiffy.com/challenges/active", "accounts.html"),
    ("https://capiffy.com/dashboard", "dashboard.html"),
    ("https://capiffy.com/challenges", "index.html"),
    ("https://capiffy.com/leaderboard", "leaderboard.html"),
    ("https://capiffy.com/affiliate", "referrals.html"),
    ("https://capiffy.com/kyc", "verification.html"),
    ("https://capiffy.com/trade", "trade.html"),
    ("https://capiffy.com/risk-disclosure", "#"),
    ("https://capiffy.com/terms", "#"),
    ("https://capiffy.com/refund", "#"),
    ("https://capiffy.com/privacy", "#"),
]

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#13131a">
  <title>{title}</title>
  <link rel="stylesheet" href="css/capiffy/dbe7481feefb38d2.css">
  <link rel="stylesheet" href="css/capiffy/59f9d657f37015b6.css">
  <link rel="stylesheet" href="css/capiffy/c1bee8ab903b382d.css">
  <link rel="stylesheet" href="css/capiffy/3ac04c147fc81d91.css">
  <link rel="stylesheet" href="css/capiffy/3c6a7efccbedf43f.css">
  <link rel="stylesheet" href="css/fonts.css">
</head>
<body data-page="{page}" data-title="{topbar}" data-no-wrap="true">
  <div id="app-root">
{content}
  </div>
  <script src="js/layout.js"></script>
  <script src="js/config.js"></script>
  <script src="js/api.js"></script>
  <script src="js/auth.js"></script>
</body>
</html>
"""

ACCOUNT_LINK = re.compile(r"https://capiffy\.com/accounts/[a-z0-9]+", re.I)

STATISTICS_BTN = re.compile(
    r'<button type="button" class="pt-acc-btn pt-acc-btn--primary">Statistics</button>',
    re.I,
)


def extract_main(html: str) -> str | None:
    m = re.search(r'<main class="dashboard-main[^"]*"[^>]*>(.*?)</main>', html, re.DOTALL)
    return m.group(1).strip() if m else None


def transform(content: str) -> str:
    content = ACCOUNT_LINK.sub("account-statistics.html", content)
    content = STATISTICS_BTN.sub(
        '<a class="pt-acc-btn pt-acc-btn--primary" href="account-statistics.html">Statistics</a>',
        content,
    )
    for old, new in LINK_REPLACEMENTS:
        content = content.replace(old, new)
    content = content.replace("CAPIFFY", "ALPHAFX")
    content = content.replace("Capiffy", "AlphaFX")
    content = content.replace("CAP38", "ALPHA38")
    return content


def extract_rules_css(html: str) -> str | None:
    for m in re.finditer(r"<style[^>]*>(.*?)</style>", html, re.DOTALL):
        s = m.group(1).strip()
        if ".to-hero" in s or ".to-step" in s:
            return s
    return None


def main():
    for src, dst, page, title, topbar in PAGES:
        path = os.path.join(DL, src)
        if not os.path.exists(path):
            print(f"skip missing: {src}")
            continue
        html = open(path, encoding="utf-8").read()
        content = extract_main(html)
        if not content:
            print(f"FAIL: no main content in {src}")
            continue
        content = transform(content)
        extra_css = ""
        if dst == "rules.html":
            rules_css = extract_rules_css(html)
            if rules_css:
                css_path = os.path.join(OUT, "css", "rules-page.css")
                open(css_path, "w", encoding="utf-8").write(rules_css)
                extra_css = '  <link rel="stylesheet" href="css/rules-page.css">\n'
        out_path = os.path.join(OUT, dst)
        page_html = HEAD.format(title=title, page=page, topbar=topbar, content=content)
        if extra_css:
            page_html = page_html.replace(
                '  <link rel="stylesheet" href="css/fonts.css">\n',
                f'  <link rel="stylesheet" href="css/fonts.css">\n{extra_css}',
            )
        extra_js = EXTRA_SCRIPTS.get(dst, [])
        if extra_js:
            page_html = page_html.replace(
                '  <script src="js/layout.js"></script>\n',
                "  <script src=\"js/layout.js\"></script>\n" + "\n".join(extra_js) + "\n",
            )
        open(out_path, "w", encoding="utf-8").write(page_html)
        print(f"built {dst} ({len(content)} bytes)")


if __name__ == "__main__":
    main()
