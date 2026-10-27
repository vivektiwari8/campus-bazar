# Campus Bazaar

College students ke liye used saman ka marketplace. Plain HTML, CSS aur JavaScript, koi build step nahi. Students apne college email se login karte hain, seller listing post karta hai, aur buyer seller ko WhatsApp par contact karta hai.

## Files

| File | Kaam |
| --- | --- |
| `index.html` | Page ka structure: login, email verify, marketplace, sell form |
| `style.css` | Colors, layout, mobile aur dark mode |
| `script.js` | Login, listings, filters, form validation, photo compress, contact |
| `firebase-config.js` | Aapki settings: college domain aur Firebase keys |
| `firestore.rules` | Database ke security rules (asli security yahin hai) |

## Login ka niyam

Sirf college email wale students login kar sakte hain. Koi demo login ya "kisi bhi email" wala option nahi hai. Jab tak `firebase-config.js` mein Firebase keys aur college domain nahi bharte, site "not set up yet" screen dikhati hai aur kisi ko login nahi karne deti.

## Real login ka setup (Firebase, free plan)

### Step 1. Project banao
1. https://console.firebase.google.com par Google account se jao.
2. **Add project** dabao, naam do (jaise `campus-bazaar`). Google Analytics band rakh sakte ho.

### Step 2. Login ke tareeke chalu karo
1. **Build > Authentication > Get started**.
2. **Sign-in method** mein **Google** enable karo (support email chuno) aur **Email/Password** enable karo (Email link wala option band rehne do).
3. **Settings > Authorized domains** mein `localhost` pehle se hota hai. Website online daalne ke baad uska address yahan add karna hoga.

### Step 3. Database banao aur rules lagao
1. **Build > Firestore Database > Create database**. **Production mode** chuno aur location `asia-south1` (Mumbai) rakho.
2. **Rules** tab kholo, `firestore.rules` ki poori file paste karo.
3. Rules mein college ka domain `its.edu.in` pehle se bhara hua hai (ek se zyada domain ho to bracket mein comma lagao). **Publish** dabao.

### Step 4. Keys files mein daalo
1. Firebase console mein gear icon > **Project settings > General > Your apps** mein **Web (`</>`)** chuno, app register karo (Hosting abhi nahi chahiye).
2. Jo `firebaseConfig` dikhe, uski `apiKey`, `authDomain`, `projectId`, `appId` ko `firebase-config.js` mein copy karo.
3. Usi file mein `allowedDomains: ['its.edu.in']` pehle se bhara hua hai. Yeh zaroori hai, aur wahi domain hona chahiye jo rules mein hai. Isko khali chhodoge to site login band rakhegi.

### Step 5. Chalao
Login `file://` se (double-click karke) nahi chalta. Folder mein terminal kholo aur yeh chalao:

```
python3 -m http.server 8000
```

Phir browser mein `http://localhost:8000` kholo. VS Code ka **Live Server** bhi chalega.

### Step 6. Online daalo
Firebase Hosting, Netlify ya GitHub Pages par poora folder upload kar do. Jo address mile, use Firebase mein **Authentication > Settings > Authorized domains** mein add karo, warna Google login `auth/unauthorized-domain` error dega.

## Kaise kaam karta hai

- Sign up par college email par verify link jaata hai. Verify hone tak koi listing nahi khulti. Google login mein email pehle se verified hota hai.
- `allowedDomains` sirf screen par message dikhane ke liye hai. Asli rok `firestore.rules` mein hai: verified email aur sahi domain ke bina listings na padhi ja sakti hain na likhi.
- Seller sirf apni listing ko sold mark ya delete kar sakta hai. Rules kisi aur ko yeh karne nahi dete.
- Seller ka WhatsApp number sabhi verified students ko dikhta hai. Form mein yeh bataya gaya hai.
- Photos chhoti karke listing ke saath hi Firestore mein rakhi jaati hain (3 tak), isliye alag Storage ya billing nahi chahiye. Jab listings bahut ho jayein to photos Firebase Storage ya Cloudinary par shift karna behtar hoga.

## Dikkat aaye to

| Message | Matlab |
| --- | --- |
| `auth/unauthorized-domain` | Website ka address Authorized domains mein add nahi hai |
| "This sign-in method is not turned on" | Step 2 mein Google ya Email/Password enable nahi kiya |
| "This account cannot open Campus Bazaar" | Email verify nahi hai, ya domain rules wale domain se match nahi karta |
| "Campus Bazaar is not set up yet" | `firebase-config.js` mein keys ya college domain nahi bhare, ya Firebase se connect nahi hua (keys galat hain, ya site `localhost` ki jagah file se khuli hai) |

## Aage ke kaam (abhi nahi bane)

- Listing report karne ka button aur kisi bure listing ko hatane ka admin tareeka (abhi Firebase console se delete karna padega).
- Seller ko seedha message (abhi sirf WhatsApp number).
- Purani listings apne aap hatana.
