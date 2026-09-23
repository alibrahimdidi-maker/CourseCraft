RASFAHI — MNQF Program Builder
==============================

This is a proper "site" folder for RASFAHI, instead of one giant file.

Folder layout:
  index.html   - the app itself. Open this in a browser (double-click, or
                 upload the whole folder to any web host).
  fonts/       - the real Dhivehi (Noto Sans Thaana), Arabic (Amiri) and
                 heading (Playfair Display) font files. These are loaded
                 locally by index.html, so Dhivehi text renders correctly
                 even with no internet connection - no dependence on
                 Google Fonts or the visitor's system having a Thaana
                 font installed.
  images/      - logo-with-name.png  = the IUM banner logo (with the
                                        university's name), used as the
                                        header/letterhead logo and shown
                                        on the login screen.
                 logo-icon-only.jpg  = the icon-only IUM logo (no text),
                                        used as the watermark, and also
                                        as the site's favicon.

Keeping this folder structure intact matters: index.html loads the fonts
and images using relative paths (fonts/... and images/...), so all four
items - the HTML file plus the fonts/ and images/ folders - need to stay
together in the same place (e.g. all four uploaded to the same folder on
a web host, or all extracted together from this zip onto your computer).

Replacing a logo: to use a different header or watermark logo by default,
replace images/logo-with-name.png or images/logo-icon-only.jpg with your
own file of the same name (same file type), or use the upload buttons
inside the app itself (Review & Export -> Header Logo & Letterhead /
Watermark) - uploads there apply per your account and don't require
touching these files at all.

Everything else (Firebase, the Archive Bank, exporting to Word/PDF,
Smart Word Importer, etc.) works exactly as before - only how fonts and
the default logos are loaded has changed.
