# LoadPay Hub – Setup (Group 8)

Open `index.html` through a web host (Vercel / Netlify / Firebase Hosting). Same link = same data on every device.
Without Firebase keys the app runs in **local test mode** (data stays in that browser only).

## 1. Firebase (Google login + shared database)
1. console.firebase.google.com > Add project > Add **Web app** > copy the config into `js/config.js`.
2. Build > Authentication > Sign-in method: enable **Google** and **Email/Password**.
3. Authentication > Settings > Authorized domains: add your Vercel domain.
4. Build > Firestore Database > **Create database** (Production mode, location asia-southeast1). Then Rules tab, paste (replace the admin email) and click **Publish**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function verified() { return signedIn() && request.auth.token.email_verified == true; }
    function activated() {
      return signedIn()
        && exists(/databases/$(database)/documents/activations/$(request.auth.uid))
        && get(/databases/$(database)/documents/activations/$(request.auth.uid)).data.activated == true;
    }
    function isAdmin() {
      return verified() && request.auth.token.email in ['ronielnyke@gmail.com'];
    }

    match /transactions/{txId} {
      allow read: if signedIn() && (resource.data.uid == request.auth.uid || isAdmin());
      allow create: if (isAdmin() || activated())
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status in ['Pending', 'Awaiting Payment'];
      allow update: if isAdmin()
        || (activated()
            && resource.data.uid == request.auth.uid
            && resource.data.status == 'Awaiting Payment'
            && request.resource.data.status == 'Pending'
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['ref', 'status', 'updated']))
        || (signedIn()
            && resource.data.uid == request.auth.uid
            && resource.data.status != 'Awaiting Payment'
            && request.resource.data.hidden == true
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['hidden']));
      allow delete: if isAdmin();
    }

    match /activations/{uid} {
      allow read: if signedIn() && (uid == request.auth.uid || isAdmin());
      allow create: if signedIn() && uid == request.auth.uid && request.resource.data.activated == false;
      allow update: if signedIn() && uid == request.auth.uid
        && resource.data.activated == false
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['email', 'hash', 'exp', 'ts', 'activated', 'activatedAt']);
      allow delete: if false;
    }

    // one document per issued key (document id = SHA-256 of the key) -> a key can never be issued twice
    match /activationKeys/{keyHash} {
      allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
      allow get: if signedIn() && resource.data.uid == request.auth.uid;
      allow list, update: if false;
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    // EmailJS public settings are readable before login so registration can send the activation key
    match /settings/email {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /settings/{docId} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
  }
}
```
## 2. EmailJS (receipt to the customer's real email)
1. emailjs.com > Add Email Service (Gmail) > copy Service ID.
2. Email Templates > New: **To Email** = `{{to_email}}`, **Subject** = `{{subject}}`, Content (HTML) = `{{{receipt_html}}}` (three braces).
3. Copy Template ID and Public Key (Account > General) into `js/config.js`.
The receipt includes the customer's Google profile photo.
## 3. GCash
Login as operator > Dashboard > **Payment Settings**: enter your real GCash number, account name and upload your GCash QR. Saved to Firestore, so it shows on all devices.
Customers pay, enter the reference number, and the operator confirms in **Dashboard** (Confirm / Reject). Confirmation emails the customer.
Operators = emails listed in `adminEmails`.

## 4. Deploy to loadpay-hub.firebaseapp.com (Google sign-in works there automatically)
```
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```
Live at https://loadpay-hub.firebaseapp.com and https://loadpay-hub.web.app

## 5. Show lambaconnect.netlify.app on the Google sign-in screen
`js/config.js` already switches `authDomain` to `lambaconnect.netlify.app` when the site runs on that domain, and `_redirects` proxies Firebase's auth pages. Do these in order, then redeploy to Netlify:
1. Firebase Console > Authentication > Settings > **Authorized domains** > add `lambaconnect.netlify.app`.
2. Google Cloud Console (project loadpay-hub) > APIs & Services > Credentials > open **Web client (auto created by Google Service)** > **Authorized redirect URIs** > add `https://lambaconnect.netlify.app/__/auth/handler` > Save (can take a few minutes).
3. Google Auth Platform (OAuth consent screen) > Branding > set **App name** to `LoadPay Hub` and save.
Also make sure Authentication > Sign-in method > **Google** is Enabled.

## 6. Publish rules from your computer (alternative)
```
firebase login
firebase deploy --only firestore:rules --project loadpay-hub
```

## 7. Activation key (sent to the user's real email)
Registered users get an 8-character key (like `K7M2-9QXA`) by email, paste it once, and are never asked again.
EmailJS setup (emailjs.com):
1. Email Templates > **Create New Template** (a 2nd template). To Email: `{{to_email}}`. Subject: `Your LoadPay Hub activation key`. Content: `Hi {{to_name}}, your activation key is: {{code}}`.
2. Copy its Template ID into `activationTemplateId` in `js/config.js` (also fill publicKey, serviceId, templateId).
Until EmailJS is configured, the app falls back to Firebase's activation link email.
Google sign-in accounts are already verified and skip activation.

## 8. Password reset inside the app
Firebase Console > Authentication > Templates > Password reset > pencil icon > **Customize action URL** > `https://lambaconnect.netlify.app/` (do the same for Email address verification). Reset links then open the app's own "Create a new password" screen.
Owner/Admin: Roniel Nyke Gonzales (ronielnyke@gmail.com). Sign in with Google to get the Dashboard.

Activation keys are random (system-generated), 8 characters, unique across all accounts, and only work for the account they were emailed to.

## 9. Online payments with PayMongo (GCash, Maya, GrabPay, Card)
Customers are sent to PayMongo Checkout, pay there, and return to the site. An order is marked **Success** only after the backend confirms the checkout is paid and its PHP amount and order reference match. PayMongo's minimum is P20. Card checkout can accept Visa and Mastercard when those card types are enabled for your PayMongo account.
1. Create and activate a PayMongo account (paymongo.com). Use your **Secret key** (`sk_test_...` for testing; use `sk_live_...` only after PayMongo activates your account). Enable GCash / Maya / GrabPay / Card under PayMongo > Settings > Payment methods. Availability depends on your merchant account and PayMongo approval.
2. Firebase Google Sign-In identifies the customer; PayMongo Checkout processes the payment separately.
3. Install Firebase Functions dependencies: `npm --prefix functions install`.
4. Run `firebase login`, then store the PayMongo key securely in Firebase Secret Manager:
   `firebase functions:secrets:set PAYMONGO_SECRET_KEY --project loadpay-hub`
   Enter only the PayMongo key at the secure prompt. Use `sk_test_...` for testing or `sk_live_...` only after PayMongo approval.
5. Deploy the Firebase Functions backend:
   `firebase deploy --only functions --project loadpay-hub`
   The functions use Firebase's built-in runtime identity to access Firestore. No `FIREBASE_SERVICE_ACCOUNT` JSON is required or should be added.
6. Redeploy the Netlify site. Its payment routes proxy to the deployed Firebase Functions. Check `https://lambaconnect.netlify.app/.netlify/functions/pm-status`; `ok:true` means the configured PayMongo secret is readable. It does not by itself confirm merchant activation or enabled methods.
Complete a test-mode payment before switching to live. If online payments are unavailable, check Firebase Function logs and confirm GCash, Maya, GrabPay and cards are enabled in PayMongo.
Never put the PayMongo secret in `js/config.js` or commit it. A Firebase Functions deployment may require the Firebase project to use Blaze billing.
Cash is an in-person counter payment, not an online gateway method. Cash orders stay pending until the operator confirms the money was received in the Dashboard. Never confirm an order based only on the customer's claim or screenshot.
The website footer and installed-app manifest show version `2.4.30` at the configured Git baseline. Each new Git commit increases the patch version automatically during the Netlify build (for example, the next commit builds as `2.4.31`). The footer and manifest retain `2.4.30` as a fallback without a Netlify build. Version assets use revalidation headers so other users can receive the updated version after a deployment.

## 10. Owner Dashboard
Only Roniel Nyke Gonzales (ronielnyke@gmail.com, Google sign-in) can open it. **Overview** shows every order from every device live (new orders pop up with a sound). **Prices & Catalog** edits data promos, load amounts, billers and service fees. Customers always see Cash, GCash, Maya, GrabPay and Visa / Mastercard; online methods are enabled only when PayMongo is connected, and offline cash/manual orders require operator confirmation.

## 11. Logo
Your logo (`logo.png` you sent) was cropped to a clean circle and exported to `img/`: `logo-512.png`, `logo-256.png`, `logo-192.png`, favicons, `apple-touch-icon.png`, `icon-maskable-512.png` and `og-image.png` (link preview). It shows in the loading screen, login, navbar, home hero, footer, browser tab, phone home screen (site.webmanifest) and the receipt email.
To show it in your EmailJS **activation** template, add `<img src="https://lambaconnect.netlify.app/img/logo-192.png" width="72" height="72" style="border-radius:50%" alt="LoadPay Hub">` at the top of the template content.

## 12. Messenger / Facebook in-app browser
Google blocks sign-in inside Messenger/Facebook's built-in browser. The login page detects it and shows an **Open in browser** button (Android) or **Copy link**; email + password and the activation key still work there. Share the site link with customers in Chrome/Safari when possible.
Every account except the owner (ronielnyke@gmail.com) must enter its emailed activation key once. After that it never asks again for that email.

## Gemini AI customer assistant
The floating **Ask AI** button opens a Gemini-powered general assistant. It can respond to general questions as well as LoadPay Hub questions, and is instructed to reply in the language and writing system used by the customer. Language coverage and factual accuracy depend on Gemini; answers are not guaranteed to be correct for every question or language. It does not read accounts, check transaction/payment status, or place orders; customers should use their signed-in account for those actions. Chat messages are sent to Google's Gemini API.

To enable replies on Netlify:
1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. In Netlify, open **Site configuration > Environment variables** and add `GEMINI_API_KEY` with the key as its value, available to **Functions** in the production deploy context. Keep this key in Netlify only; never add it to `js/config.js` or commit it.
3. Trigger a new Netlify deploy. The assistant uses the stable `gemini-4-hydrogen` model by default. To select another model available to your API key, set the optional `GEMINI_MODEL` environment variable to its exact model ID and redeploy.
4. Open the deployed site and send a test question. If the key is missing, invalid, or the model is unavailable to the account, the chat reports that it cannot answer instead of pretending to be working.

Gemini API usage may be subject to Google quotas and billing. Set usage limits for the API key/project in Google AI Studio or Google Cloud. The key stays server-side in the Netlify Function; browser requests go to `/.netlify/functions/assistant`.
If the function returns HTTP 503, read its response message: it distinguishes a missing `GEMINI_API_KEY` from a Gemini quota/rate limit. After changing Netlify environment variables, trigger a new deploy so the function receives them.

## 13. History: select & delete
Customers can **Select** several records or **Delete all**; this only hides them from their own history (the owner still keeps every record in the Dashboard). Unpaid "Awaiting Payment" orders cannot be deleted until finished. The owner can delete permanently. Publish the updated `firestore.rules`.

## 14. Email settings and real promos (no code editing needed)
Dashboard > **Payments** > Email Service: paste your EmailJS Public Key, Service ID, Activation Template ID and Receipt Template ID, press Save, then **Send test email to me**. Registered users then get their activation key by email.
Dashboard > **Prices & Catalog** > Data Promos > **Load real PH promos** fills Globe, Smart, TNT, Sun and DITO promos (with promo codes). Edit prices to match your supplier, then Save.
Paid Load/Data orders appear at the top of Overview under **Orders to load**: load the number with your retailer/GCash app, then tap **Mark loaded** (the customer is emailed).

## 15. Activation email shows no code?
The app sends the key under many variable names (`code`, `activation_code`, `activation_key`, `otp`, `key`, ...), plus `to_name` and `message`. Your EmailJS template must contain one of them, e.g. `{{code}}`. Easiest: Dashboard > Payments > Email Service > **Copy activation template**, then in EmailJS open the Activation template > Edit Content > code view, paste, Save, and press **Send test email to me** (the test key is TEST-1234).
"# loadpay-hub" 
