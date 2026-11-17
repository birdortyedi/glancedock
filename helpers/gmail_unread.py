#!/usr/bin/env python3
"""Unread mail in Gmail's Primary inbox, through GNOME Online Accounts.

Prints {"email": ..., "unread": N}. Uses the Google account's own OAuth token
(no password, nothing stored) and only reads a count over IMAP.
"""
import imaplib
import json
import sys

import gi

gi.require_version("Goa", "1.0")
from gi.repository import Goa  # noqa: E402

QUERY = '"in:inbox is:unread category:primary"'


def main():
    accounts = [o for o in Goa.Client.new_sync(None).get_accounts()
                if o.get_account().props.provider_type == "google" and o.get_mail()]
    if not accounts:
        sys.exit("no Google account with Mail on in Online Accounts")
    obj = accounts[0]
    email = obj.get_mail().props.email_address
    token = obj.get_oauth2_based().call_get_access_token_sync(None)[0]
    imap = imaplib.IMAP4_SSL("imap.gmail.com", timeout=20)
    try:
        imap.authenticate("XOAUTH2", lambda _: f"user={email}\1auth=Bearer {token}\1\1".encode())
        imap.select("INBOX", readonly=True)
        _, data = imap.search(None, "X-GM-RAW", QUERY)
    finally:
        imap.logout()
    print(json.dumps({"email": email, "unread": len(data[0].split())}))


if __name__ == "__main__":
    main()
