"""
Domains that are almost never a company's OFFICIAL website, even though they
rank highly in search results for a company name. Used to heavily penalize /
drop candidates during resolution.

This list is intentionally editable — add region-specific directories
(e.g. Justdial, IndiaMart, Sulekha for India; Yelp, BBB for US) as needed.
"""

NON_OFFICIAL_DOMAINS = {
    # Social / professional networks
    "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "youtube.com", "pinterest.com", "tiktok.com", "reddit.com", "threads.net",
    "quora.com", "tumblr.com", "snapchat.com",

    # Business info / B2B directories / intelligence / review sites
    "crunchbase.com", "bloomberg.com", "glassdoor.com", "indeed.com",
    "zoominfo.com", "owler.com", "craft.co", "builtin.com", "dnb.com",
    "yellowpages.com", "yelp.com", "bbb.org", "manta.com", "trustpilot.com",
    "g2.com", "capterra.com", "getapp.com", "sourceforge.net", "clutch.co",
    "apollo.io", "lusha.com", "rocketreach.co", "pitchbook.com", "cbinsights.com",
    "lead411.com", "contactout.com", "adapt.io", "upcity.com", "goodfirms.co",

    # India-specific business registries & directories
    "justdial.com", "indiamart.com", "sulekha.com", "tradeindia.com",
    "zaubacorp.com", "tofler.in", "mca.gov.in", "companycheck.co.uk",
    "opencorporates.com", "similarweb.com", "wappalyzer.com",
    "instafinancials.com", "ambitionbox.com", "fundoodata.com", "vakilsearch.com",
    "indiafilings.com", "quickcompany.in",

    # Financial / Stock market / Stock news
    "moneycontrol.com", "economictimes.indiatimes.com", "livemint.com",
    "business-standard.com", "ndtvprofit.com", "financialexpress.com",
    "screener.in", "trendlyne.com", "tickertape.in", "marketwatch.com",
    "finance.yahoo.com", "wsj.com", "ft.com", "seekingalpha.com", "nasdaq.com",

    # Reference / knowledge sites
    "wikipedia.org", "wikidata.org", "britannica.com", "investopedia.com",

    # News / press release aggregators
    "forbes.com", "businessinsider.com", "techcrunch.com", "reuters.com",
    "prnewswire.com", "businesswire.com", "globenewswire.com", "medium.com",
    "substack.com", "theverge.com", "cnbc.com", "bbc.com", "nytimes.com",

    # App stores / dev platforms / package repos
    "apps.apple.com", "play.google.com", "github.com", "gitlab.com", "bitbucket.org",
    "npmjs.com", "pypi.org", "producthunt.com", "stackshare.io",

    # Job boards
    "monster.com", "naukri.com", "shine.com", "ziprecruiter.com", "foundit.in",
    "simplyhired.com", "internshala.com", "unstop.com",
}


def is_non_official(domain: str) -> bool:
    """Return True if the given registered domain is a known non-official host."""
    domain = domain.lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain in NON_OFFICIAL_DOMAINS
