import base64

from playwright.sync_api import sync_playwright


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://localhost:29229")
        page = browser.contexts[0].new_page()
        page.goto("http://localhost:5173/login")
        page.fill('input[type="email"]', "admin@reference.ci")
        page.fill('input[type="password"]', "admin123")
        page.click('button[type="submit"]')
        page.wait_for_url("http://localhost:5173/")
        page.goto("http://localhost:5173/ventes")
        page.locator('button[title="Reçu de caisse"]').first.click()
        page.wait_for_selector("#receipt-print-root", state="attached")
        page.evaluate("window.print = () => {}")
        cdp = browser.contexts[0].new_cdp_session(page)
        for fmt in ("A4", "80mm"):
            page.select_option('select:has(option[value="80mm"])', fmt)
            page.get_by_role("button", name="Imprimer").click()
            print(
                fmt,
                "rule:",
                page.evaluate(
                    "document.getElementById('receipt-page-style').textContent"
                ),
            )
            res = cdp.send(
                "Page.printToPDF",
                {"preferCSSPageSize": True, "printBackground": True},
            )
            out = f"/home/ubuntu/receipt-{fmt}.pdf"
            with open(out, "wb") as fh:
                fh.write(base64.b64decode(res["data"]))
            print("wrote", out)
        page.close()


if __name__ == "__main__":
    main()
