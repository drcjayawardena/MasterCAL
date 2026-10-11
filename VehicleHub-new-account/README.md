# VehicleHub — අලුත් Gmail ගිණුමකට ස්ථාපනය කිරීම (v3.6)

මේ පැකේජයෙන් VehicleHub **හිස් දත්ත සමඟ** අලුත් Google ගිණුමකට සම්පූර්ණයෙන්ම ස්ථාපනය කරන්න පුළුවන්.
Frontend එක දැනට තියෙන තැනම (`drcjayawardena.github.io/VehicleHUB`) තියෙනවා — `config.js` එකේ URL එක පමණක් වෙනස් වෙනවා.

```
apps-script/      → Google Apps Script එකට (Code.gs, Matching.gs, Index.html)
github-pages/     → GitHub VehicleHUB repo එකට (index.html, request.html, vehicles.html,
                    config.js, sw.js, manifest.webmanifest, icon-192.png, icon-512.png)
```

## දැනටමත් සකසා ඇති දේවල්

| Setting | අගය |
|---|---|
| App නම | VehicleHub |
| පොදු දුරකථන අංකය (Showroom Call/WhatsApp) | 0714100518 |
| Facebook | https://www.facebook.com/profile.php?id=61593573333056 |
| පළමු admin | නම **Ravi**, username **ravi** (login එකේදී "Ravi" ලිව්වත් වැඩ), 0779100518, drcjayawardena@gmail.com |
| Website | https://drcjayawardena.github.io/VehicleHUB/ |

මේවා වෙනස් කරන්න ඕනේ නම්: `apps-script/Code.gs` උඩම ඇති `APP` සහ `FIRST_ADMIN` කොටස්.

**v3.5 → v3.6 වෙනස්කම්:**
- පරණ `admin / admin123` වෙනුවට **Ravi** admin ගිණුම, **අහඹු තාවකාලික මුරපදයක්** සමඟ හැදෙනවා.
- Match එකක status එක save කරද්දී එකවර re-match එකක් දිව්වොත් වෙනස මැකී යාම නැවැත්තුවා (lock).
- Record එකක් මකද්දී වෙනත් record එකක් overwrite වීමේ අවදානම නැවැත්තුවා.
- ID 9999 ඉක්මවූ පසු (`B10000`) සිදුවන ගැටුම නිවැරදි කළා.
- Service worker: request.html / vehicles.html offline විවෘත කළොත් නිවැරදි පිටුව පෙන්වනවා.

---

## පියවර 1 — Google Sheet සහ Apps Script (අලුත් Gmail ගිණුමෙන්)

1. **අලුත් Gmail ගිණුමෙන්** log වෙන්න. වෙනත් ගිණුම් log out කරන්න, නැත්නම් Incognito window එකක් පාවිච්චි කරන්න.
2. https://sheets.new විවෘත කරලා Sheet එකට නමක් දෙන්න, උදා: `VehicleHub DB`.
3. Sheet එකේ **Extensions → Apps Script** යන්න.
4. Apps Script editor එකේදී:
   - `Code.gs` එකේ තියෙන දේ මකලා, `apps-script/Code.gs` සම්පූර්ණයෙන්ම paste කරන්න.
   - **+ → Script** තෝරලා නම `Matching` ලෙස දෙන්න, `apps-script/Matching.gs` paste කරන්න.
   - **+ → HTML** තෝරලා නම `Index` ලෙස දෙන්න (`.html` ලියන්න එපා), `apps-script/Index.html` paste කරන්න.
   - 💾 Save (Ctrl+S).
5. **⚙ Project Settings** යන්න:
   - Time zone: `(GMT+05:30) Colombo`
   - "Enable Chrome V8 runtime" tick කරලා තියෙන්න ඕනේ.
6. Editor එකට ආපහු ගිහින් උඩ dropdown එකෙන් **`setup`** තෝරලා **▶ Run** කරන්න.
   - "Authorization required" ආවොත් → **Review permissions** → ඔබේ ගිණුම තෝරන්න → **Advanced** → **Go to … (unsafe)** → **Allow**.
     (මේ ඔබ ම ලියපු script එක නිසා Google මෙහෙම පෙන්වනවා.)
7. පහළ **Execution log** එකේ මෙවැනි පේළියක් පෙනෙයි:
   `✅ Setup complete. Login: ravi / a1b2c3d4e5 (change the password right away)`
   👉 **මේ තාවකාලික මුරපදය ලියා ගන්න.** මේක පෙන්වන්නේ එක් වතාවක් විතරයි.
8. (කැමති නම්) dropdown එකෙන් **`installHourlyTrigger`** තෝරලා ▶ Run කරන්න. එතකොට පැයෙන් පැයට auto re-match වෙනවා.

## පියවර 2 — Web App ලෙස Deploy කිරීම

1. **Deploy → New deployment** යන්න.
2. ⚙ (Select type) → **Web app** තෝරන්න.
3. පහත අගයන් දෙන්න:
   - Description: `v3.6`
   - Execute as: **Me**
   - Who has access: **Anyone** ← මේක අනිවාර්යයි. නැත්නම් website එකට server එකට සම්බන්ධ වෙන්න බැහැ.
4. **Deploy** ඔබලා, ලැබෙන **Web app URL** එක copy කරන්න. ඒක `https://script.google.com/macros/s/…/exec` ආකාරයෙන් අවසන් වෙනවා.
5. පරීක්ෂාව: ඒ URL එකේ අගට `?ping=1` එකතු කරලා browser එකේ විවෘත කරන්න.
   `{"ok":true,"app":"VehicleHub","versions":{"code":"3.6","matching":"3.6"}}` පෙනුනොත් backend එක හරි.

> ⚠ **පසුව කේතය update කරද්දී:** "New deployment" කරන්න එපා, එහෙම කළොත් URL එක වෙනස් වෙනවා.
> **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** කරන්න. එතකොට URL එක එලෙසම තියෙනවා.

## පියවර 3 — GitHub (drcjayawardena/VehicleHUB)

1. https://github.com/drcjayawardena/VehicleHUB විවෘත කරන්න.
2. **Add file → Upload files** → `github-pages/` ෆෝල්ඩරයේ ඇති ගොනු 8ම drag කරන්න (පරණ ඒවා replace වෙනවා) → **Commit changes**.
3. Repo එකේ `config.js` විවෘත කරලා ✏ Edit කරන්න. `PASTE_YOUR_WEB_APP_URL_HERE` වෙනුවට පියවර 2 දී copy කරපු `/exec` URL එක දාලා Commit කරන්න:
   ```js
   window.VM_API_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
   ```
4. විනාඩි 1–2ක් ඉඳලා https://drcjayawardena.github.io/VehicleHUB/ විවෘත කරන්න. පරණ cache එක ඉවත් කරන්න **Ctrl+F5** ඔබන්න. Phone එකේ නම් app එක වහලා ආයෙත් විවෘත කරන්න.

## පියවර 4 — පළමු login එක සහ පරීක්ෂාව

1. Username **Ravi** සහ පියවර 1.7 දී ලියාගත් තාවකාලික මුරපදයෙන් login වෙන්න.
2. **Settings → Change password** යන්න. අලුත් මුරපදයක් දාන්න (අකුරු 6+).
3. **Settings → My officer profile → Test email** ඔබලා drcjayawardena@gmail.com එකට email එකක් ආවද බලන්න.
4. පරීක්ෂණ Vehicle එකක් සහ Buyer කෙනෙක් ඇතුළත් කරලා Match එකක් හැදෙනවද බලන්න. ඊට පස්සේ admin ලෙස ඒ දෙක මකන්න.
5. `request.html` (පෝරමය) සහ `vehicles.html` (Showroom) පිටු දෙකත් විවෘත කරලා බලන්න.
6. **අනෙක් නිලධාරීන්:** login පිටුවේ "Create an account" හරහා අලුතින් ලියාපදිංචි වෙන්න කියන්න. ඊට පස්සේ Ravi **Settings → Users** වලින් ඔවුන්ව approve කරන්න.

> පරණ ගිණුමේ Sheet එක සහ ඡායාරූප එලෙසම පරණ ගිණුමේ backup එකක් ලෙස ඉතිරි වෙනවා. `config.js` වෙනස් කළාට පස්සේ website එක පාවිච්චි කරන්නේ අලුත් ගිණුම විතරයි.

---

## පියවර 5 — WhatsApp Cloud API (අලුතින් සකසන්න)

Lead එකක් ලැබුණු ගමන් පාරිභෝගිකයාට ස්වයංක්‍රීයව WhatsApp පණිවිඩයක් යවන්න මේක පාවිච්චි වෙනවා. මේක සකසන්නේ නැතුව වුණත් අනෙක් හැම දෙයක්ම වැඩ කරනවා.

**කලින්ම දැනගන්න:**
- WhatsApp Cloud API එකෙන් යවන template පණිවිඩ වලට **Meta ගාස්තු අය කරනවා**. මිල ගණන් https://developers.facebook.com/docs/whatsapp/pricing එකෙන් බලන්න. ගෙවීමේ ක්‍රමයක් (card) එකතු කරන්න වෙනවා.
- ⚠ API එකට register කරන දුරකථන අංකය **සාමාන්‍ය WhatsApp / WhatsApp Business app එකේ පාවිච්චි කරන්න බැහැ.** 0714100518 දැනට phone එකේ WhatsApp වල තියෙනවා නම් ඒක දාන්න එපා. ඒ වෙනුවට **වෙනම SIM අංකයක්** පාවිච්චි කරන එක හොඳයි.

**පියවර:**
1. https://business.facebook.com හි **Meta Business Account** එකක් හදන්න (නම: VehicleHub).
2. https://developers.facebook.com → **My Apps → Create App** → Use case එක ලෙස **"Connect with customers through WhatsApp"** (Business type) තෝරලා Business account එකට සම්බන්ධ කරන්න.
3. App එකේ **WhatsApp → API Setup** යන්න:
   - **Add phone number** → අලුත් අංකය දාලා SMS/call මගින් verify කරන්න.
   - ලැබෙන **Phone number ID** එක ලියා ගන්න. (මේක දුරකථන අංකය නෙවෙයි, දිගු ඉලක්කමක්.)
4. **ස්ථිර Token එකක්** හදන්න:
   - Business Settings → **Users → System users → Add** (Admin) යන්න.
   - **Assign assets** → ඔබේ App එක තෝරලා Full control දෙන්න.
   - **Generate new token** → App එක තෝරන්න → Expiration: **Never** → permissions `whatsapp_business_messaging` සහ `whatsapp_business_management` tick කරන්න.
   - Token එක copy කරගන්න. ⚠ මේක මුරපදයක් වගේ. කාටවත් දෙන්න එපා, මටත් එවන්න එපා.
5. **Message template** එකක් හදන්න (WhatsApp Manager → Message templates → Create):
   - Category: **Utility**
   - Name: `lead_received`
   - Language: **English (US)**
   - Body (variables 3, මේ පිළිවෙළටම):
     ```
     Hello {{1}}, thank you for contacting VehicleHub. Your reference number is {{2}}. Our agent {{3}} will contact you soon.
     ```
     (`{{1}}` = පාරිභෝගිකයාගේ නම, `{{2}}` = යොමු අංකය L0001, `{{3}}` = නිලධාරියාගේ නම)
   - Submit කරලා **Approved** වෙනකම් ඉන්න. සාමාන්‍යයෙන් මිනිත්තු කිහිපයක් සිට පැය කිහිපයක් යනවා.
6. Apps Script → ⚙ **Project Settings → Script properties → Add script property** යන්න. මේ properties හතර එකතු කරන්න:

   | Property | Value |
   |---|---|
   | `WA_TOKEN` | පියවර 4 දී ලැබුණු token එක |
   | `WA_PHONE_ID` | පියවර 3 දී ලැබුණු Phone number ID එක |
   | `WA_LEAD_TEMPLATE` | `lead_received` |
   | `WA_LANG` | `en_US` |

7. පරීක්ෂාව: `request.html` පෝරමයෙන් ඔබේම අංකයෙන් ඉල්ලීමක් යවන්න. WhatsApp පණිවිඩය ආවේ නැත්නම් Apps Script → **Executions** එකේ `WA lead send failed:` කියන පේළිය බලන්න.

> Business verification කරලා නැති අලුත් ගිණුමකින් දවසකට යවන්න පුළුවන් පණිවිඩ ගණන Meta සීමා කරනවා.
> පණිවිඩ වැඩියෙන් යවන්න ඕනේ නම් Business Settings → **Security Center → Start verification** කරන්න.

---

## සීමා

- සාමාන්‍ය Gmail ගිණුමකින් **දවසකට email 100ක්** විතරයි යවන්න පුළුවන්. Match alerts, lead emails සහ පාරිභෝගික තහවුරු කිරීම් ඔක්කොම මේකට අයිතියි. Google Workspace ගිණුමකට මේ සීමාව 1,500යි.
- Apps Script එකක් එක් වරකට උපරිම විනාඩි 6ක් දුවන්න පුළුවන්. දත්ත ඉතා වැඩි වුණාම `refreshAllMatches` එක මන්දගාමී වෙන්න පුළුවන්.
