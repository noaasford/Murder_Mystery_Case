# Murder Mystery — 4 to 30 players

A browser-based realtime social deduction game using Firebase Authentication + Realtime Database + Firebase Hosting.

## 1. What is included

- Create / join rooms
- 4–30 players
- Anonymous Firebase login
- Host + lobby
- Secret roles
- Murderer / Detective / Investigator / Witness / Innocent
- Secret murderer target
- Private investigation
- Clues
- Voting
- Round results
- Win conditions
- Responsive mobile UI
- Firebase Hosting configuration

## 2. Create the Firebase project

1. Open Firebase Console.
2. Create a new project.
3. Add a Web App.
4. Copy the Web App config.
5. Open `firebase.js`.
6. Replace the placeholder values in `firebaseConfig`.

Official setup:
https://firebase.google.com/docs/web/setup

## 3. Enable Anonymous Authentication

Firebase Console → Authentication → Sign-in method → Anonymous → Enable.

Official guide:
https://firebase.google.com/docs/auth/web/anonymous-auth

## 4. Create Realtime Database

Firebase Console → Realtime Database → Create Database.

Copy the database URL into `firebase.js`:

    databaseURL: "https://YOUR_DATABASE_URL"

The URL can be either:
- https://DATABASE_NAME.firebaseio.com
- https://DATABASE_NAME.REGION.firebasedatabase.app

Official guide:
https://firebase.google.com/docs/database/web/start

## 5. Apply the database rules

The file `database.rules.json` contains the rules used by this prototype.

If using Firebase CLI:

    firebase deploy --only database

## 6. Install Firebase CLI

Node.js is recommended.

    npm install -g firebase-tools

Login:

    firebase login

Check:

    firebase --version

## 7. Connect this folder to Firebase

Copy `.firebaserc.example` to `.firebaserc`.

Then replace:

    YOUR_FIREBASE_PROJECT_ID

with your real Firebase project ID.

Or run:

    firebase use --add

and select your project.

## 8. Test locally

From this folder:

    firebase serve

Then open the local URL shown by the CLI.

For realtime multiplayer testing, open the site in several browser tabs/devices.

## 9. Deploy

Run:

    firebase deploy

Firebase will print the Hosting URL.

## Important security note

This is a functional prototype, not an anti-cheat competitive game.

The client can read the private role of the current user, and the host is trusted to resolve actions. For a production-grade game, move role assignment, murder resolution, vote counting, and win-condition validation to trusted server-side code such as Cloud Functions, and add App Check/rate limiting.

Also do not leave a database in public test mode.

## Gameplay

1. Host creates room.
2. Players join with the 6-character code.
3. Minimum 4 players.
4. Host starts.
5. Roles are randomly assigned.
6. Investigation phase begins.
7. Murderers can secretly choose a target.
8. Detectives/investigators can secretly inspect a suspect.
9. Host resolves the investigation.
10. Host opens voting.
11. Players vote.
12. Host resolves the vote.
13. Host starts the next round.
14. The game ends when all murderers are removed or murderers equal/outnumber the remaining non-murderers.

## Customization

Edit:
- `ROLE_INFO` in `app.js` for role descriptions.
- `CLUES` in `app.js` for clues.
- `murdererCount()` for murderer scaling.
- `specialRoles()` for special-role scaling.
- `style.css` for the visual design.
