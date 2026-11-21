#!/usr/bin/env python3
"""Local server for Richy & Lydia's invitation.

Serves the page and keeps every reply in data/rsvps.json so all visitors
see the same guest count. Stay and food choices are private: they are kept
on disk for the couple, left out of the public guest list, and emailed to
nobleandnew@gmail.com when a mail account is configured.

    python server.py            # http://127.0.0.1:8123
    PORT=9000 python server.py  # another port

Mail settings come from mail.json in this folder (or MAIL_* env vars):

    {
      "host": "smtp.gmail.com",
      "port": 465,
      "ssl": true,
      "user": "nobleandnew@gmail.com",
      "password": "the Gmail app password",
      "to": "nobleandnew@gmail.com"
    }

Without a mail account every RSVP is written to data/mail-outbox.log
instead, so nothing is lost.
"""

import json
import os
import smtplib
import tempfile
import threading
import time
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "rsvps.json")
MAIL_CONFIG = os.path.join(ROOT, "mail.json")
MAIL_OUTBOX = os.path.join(DATA_DIR, "mail-outbox.log")
MAIL_TO_DEFAULT = "nobleandnew@gmail.com"
LOCK = threading.Lock()

MAX_NAME = 32
MAX_NOTE = 280
MAX_FOOD_NOTE = 200
MAX_CHOICE = 24
MAX_BODY = 8_000

STAY_CHOICES = ("Camping", "Other place")
FOOD_CHOICES = ("Vegan", "Gluten-free", "Allergies", "Other")

# Kept on the server for the couple, never sent to visitors.
PRIVATE_FIELDS = ("stay", "food", "foodNote")


def load_guests():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []

    guests = data.get("guests") if isinstance(data, dict) else data
    if not isinstance(guests, list):
        return []
    return [guest for guest in guests if isinstance(guest, dict) and guest.get("name")]


def save_guests(guests):
    os.makedirs(DATA_DIR, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=DATA_DIR, delete=False, suffix=".tmp"
    )
    try:
        json.dump({"guests": guests}, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, DATA_FILE)


def clean(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def clean_choices(value, allowed):
    if not isinstance(value, list):
        return []
    picked = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = " ".join(item.split())[:MAX_CHOICE]
        if text in allowed and text not in picked:
            picked.append(text)
    return picked


def public_guest(guest):
    return {key: value for key, value in guest.items() if key not in PRIVATE_FIELDS}


def mail_settings():
    settings = {
        "host": os.environ.get("MAIL_HOST", ""),
        "port": int(os.environ.get("MAIL_PORT") or 0),
        "ssl": (os.environ.get("MAIL_SSL") or "1").lower() not in ("0", "false", "no"),
        "user": os.environ.get("MAIL_USER", ""),
        "password": os.environ.get("MAIL_PASSWORD", ""),
        "to": os.environ.get("MAIL_TO") or MAIL_TO_DEFAULT,
    }

    try:
        with open(MAIL_CONFIG, "r", encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError):
        config = None

    if isinstance(config, dict):
        for key in ("host", "user", "password", "to"):
            value = config.get(key)
            if isinstance(value, str) and value.strip():
                settings[key] = value.strip()
        try:
            if config.get("port"):
                settings["port"] = int(config["port"])
        except (TypeError, ValueError):
            pass
        if "ssl" in config:
            settings["ssl"] = bool(config["ssl"])

    if not settings["port"]:
        settings["port"] = 465 if settings["ssl"] else 25
    return settings


def rsvp_text(guest):
    stamp = guest.get("updatedAt") or guest.get("createdAt") or 0
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime(stamp / 1000 if stamp else time.time()))
    lines = [
        "New RSVP for Richy & Lydia",
        "",
        "Name:  " + guest.get("name", ""),
        "Reply: " + ("Joyfully accepts" if guest.get("coming", True) else "Regretfully declines"),
        "Stay:  " + (", ".join(guest.get("stay") or []) or "-"),
        "Food:  " + (", ".join(guest.get("food") or []) or "-"),
        "Notes: " + (guest.get("foodNote") or "-"),
        "Story: " + (guest.get("note") or "-"),
        "Sent:  " + when,
    ]
    return "\n".join(lines)


def write_outbox(text, reason=""):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MAIL_OUTBOX, "a", encoding="utf-8") as handle:
        handle.write("\n" + "-" * 64 + "\n" + text + "\n")
        if reason:
            handle.write("\n[" + reason + "]\n")


def send_rsvp_email(guest):
    settings = mail_settings()
    text = rsvp_text(guest)

    if not settings["host"]:
        write_outbox(text, "no mail account configured - saved instead of emailed")
        return

    message = EmailMessage()
    message["Subject"] = "New RSVP from " + (guest.get("name") or "a guest")
    message["From"] = settings["user"] or MAIL_TO_DEFAULT
    message["To"] = settings["to"]
    message.set_content(text)

    try:
        if settings["ssl"]:
            smtp = smtplib.SMTP_SSL(settings["host"], settings["port"], timeout=20)
        else:
            smtp = smtplib.SMTP(settings["host"], settings["port"], timeout=20)
            if settings["user"]:
                smtp.starttls()
        with smtp:
            if settings["user"]:
                smtp.login(settings["user"], settings["password"])
            smtp.send_message(message)
        print("Emailed the RSVP from %s to %s" % (guest.get("name"), settings["to"]), flush=True)
    except Exception as error:  # a reply is never lost because mail failed
        write_outbox(text, "email failed: %s" % error)


class InvitationHandler(SimpleHTTPRequestHandler):
    server_version = "InvitationServer/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/rsvps":
            with LOCK:
                guests = load_guests()
            self.send_json(200, {"guests": [public_guest(guest) for guest in guests]})
            return

        # The reply file holds private choices: never hand it to a browser.
        if path.startswith("/data/") or path == "/mail.json":
            self.send_json(403, {"error": "Not available"})
            return

        if path in ("", "/"):
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/rsvps":
            self.send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(400, {"error": "Invalid request"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid request"})
            return

        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Invalid request"})
            return

        first = clean(payload.get("first"), MAX_NAME)
        last = clean(payload.get("last"), MAX_NAME)
        note = clean(payload.get("note"), MAX_NOTE)
        food_note = clean(payload.get("foodNote"), MAX_FOOD_NOTE)
        stay = clean_choices(payload.get("stay"), STAY_CHOICES)
        food = clean_choices(payload.get("food"), FOOD_CHOICES)
        coming = payload.get("coming") is not False

        if not first or not last:
            self.send_json(400, {"error": "Please add your first and last name."})
            return

        name = (first + " " + last).strip()
        now = int(time.time() * 1000)

        with LOCK:
            guests = load_guests()
            existing = next(
                (guest for guest in guests if str(guest.get("name", "")).lower() == name.lower()),
                None,
            )
            if existing:
                existing.update(
                    {
                        "first": first,
                        "last": last,
                        "name": name,
                        "note": note,
                        "coming": coming,
                        "stay": stay,
                        "food": food,
                        "foodNote": food_note,
                        "updatedAt": now,
                    }
                )
                record = existing
            else:
                record = {
                    "first": first,
                    "last": last,
                    "name": name,
                    "note": note,
                    "coming": coming,
                    "stay": stay,
                    "food": food,
                    "foodNote": food_note,
                    "createdAt": now,
                }
                guests.append(record)
            save_guests(guests)
            reply_to_email = dict(record)

        threading.Thread(target=send_rsvp_email, args=(reply_to_email,), daemon=True).start()

        self.send_json(200, {"guests": [public_guest(guest) for guest in guests]})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    host = os.environ.get("HOST") or "127.0.0.1"
    try:
        port = int(os.environ.get("PORT") or 8123)
    except ValueError:
        port = 8123
    if not port:
        port = 8123
    httpd = ThreadingHTTPServer((host, port), InvitationHandler)
    print("Serving the invitation on http://%s:%d" % (host, port), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
