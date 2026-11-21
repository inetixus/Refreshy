Refreshy v0.1.3 — Windows x64 (unpacked build)
FIX: invisible overlay was swallowing every click — the two home buttons
now work.

HOW TO RUN:

1. Download BOTH parts into the same folder:
   - Refreshy-v0.1.3-win-x64.zip.part00  (must be exactly 94,371,840 bytes)
   - Refreshy-v0.1.3-win-x64.zip.part01  (must be exactly 27,289,078 bytes)
   Direct links (right-click → Save link as):
   https://raw.githubusercontent.com/inetixus/Refreshy/vibe/refreshy-app-123574/releases/v0.1.3/Refreshy-v0.1.3-win-x64.zip.part00
   https://raw.githubusercontent.com/inetixus/Refreshy/vibe/refreshy-app-123574/releases/v0.1.3/Refreshy-v0.1.3-win-x64.zip.part01

2. Rejoin them (PowerShell or Command Prompt, in that folder):
   cmd /c copy /b Refreshy-v0.1.3-win-x64.zip.part00+Refreshy-v0.1.3-win-x64.zip.part01 Refreshy-v0.1.3-win-x64.zip

3. (Optional) verify integrity:
   certutil -hashfile Refreshy-v0.1.3-win-x64.zip SHA256
   expected: cc947d1d87a45d5cd6f4fb656a2f49c5c3249affbdfeddc94d5f8d8db9bc947d

4. Right-click the ZIP → Extract All.

5. Open the extracted win-unpacked folder and double-click Refreshy.exe.

CHECK: the home screen must show "Refreshy v0.1.3" under the headline,
and both cards must switch views when clicked.

SmartScreen: "More info" → "Run anyway" (this build is not code-signed).
