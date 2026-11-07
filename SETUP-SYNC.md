# Setting up sync (Firebase, free)

This takes about 10 minutes in a browser. It uses Firebase's free **Spark** plan, which doesn't ask for a credit card. If Firebase ever suggests upgrading to Blaze (pay as you go), say no. Nothing here needs it.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with a Google account. That account owns the project.
2. **Create a project.** Name it something like `match-tracker`.
3. When it asks about **Google Analytics**, turn it **off**. It isn't needed.

## 2. Turn on email/password sign-in
1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → turn on the first switch only (leave "Email link" off) → **Save**.
3. **Users** tab → **Add user** → enter your dad's email and a password → **Add user**.
   - Every account has its **own separate data**. If you want to see or fix his matches on your devices, sign in with *his* account there too.
4. Optional, if you see it: **Settings** tab → **User actions** → uncheck **Enable create (sign-up)**. The app has no sign-up button anyway, so this just makes sure nobody can create accounts in your project.

## 3. Create the database
1. Left menu: **Build → Firestore Database → Create database**.
2. If it asks for an edition, choose **Standard**.
3. Location: pick a **United States** location (for example `nam5`). This can't be changed later.
4. Choose **Start in production mode** → **Create**.
5. Open the **Rules** tab. Replace everything there with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
   These rules let each signed-in person read and write only their own data. Everyone else is refused.

## 4. Connect the app
1. Click the gear icon → **Project settings** → **General**. Under **Your apps**, click the **Web** icon (`</>`).
2. Nickname: `Match Tracker`. **Don't** check Firebase Hosting → **Register app**.
3. Copy the `firebaseConfig = { ... }` values it shows. Either paste them into [`js/firebase-config.js`](js/firebase-config.js) in place of `null`, or send them to Claude.
   These values aren't secret. Every Firebase web app publishes them, and the security rules protect the data.

## 5. Publish and sign in
1. Publish the change (see README → "Publishing an update").
2. On the laptop, open the site → sign in → Settings. If there's data from before sign-in, tap **Copy them to my account**.
3. On the iPhone, open the **home-screen app** → sign in.
4. Test it: add a match on one device and check that it shows up on the other within a few seconds. Then put the phone in airplane mode, add a match, turn airplane mode off, and check it reaches the laptop.

## If something goes wrong
- **"Sync problem: the database refused access"**: the rules from step 3.5 weren't published.
- **"That email and password don't match an account"**: check the user in Authentication → Users. You can reset the password there, or use "Forgot password?" in the app.
- **Forgot which Google account owns the project:** it's the one signed in at console.firebase.google.com that lists the project.
