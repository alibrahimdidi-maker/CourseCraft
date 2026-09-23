// RASFAHI - optional admin helper (Firebase Cloud Function).
// Lets the Admin change a user's password directly, lock/unlock the login itself, and fully
// remove a login record. Without it, the web app still works: it blocks disabled/deleted users
// through Firestore and sends a password-reset email instead of setting a password.
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

const ADMIN_EMAILS = ['alibrahimdidi@gmail.com'];
const { HttpsError } = functions.https;

exports.rasfahiAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Please sign in first.');

  const callerEmail = String(context.auth.token.email || '').toLowerCase();
  let isAdmin = ADMIN_EMAILS.includes(callerEmail);
  if (!isAdmin) {
    const snap = await admin.firestore().doc('rasfahi_accounts/' + context.auth.uid).get();
    const acc = snap.exists ? snap.data() : {};
    isAdmin = acc.role === 'admin' && !acc.disabled && !acc.deleted;
  }
  if (!isAdmin) throw new HttpsError('permission-denied', 'Only the admin can do this.');

  const action = data && data.action;
  const uid = data && data.uid;
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'Missing user id.');
  if (uid === context.auth.uid && action !== 'setPassword') {
    throw new HttpsError('failed-precondition', 'You cannot disable or delete your own account.');
  }

  switch (action) {
    case 'setPassword': {
      const pw = data.password;
      if (typeof pw !== 'string' || pw.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
      await admin.auth().updateUser(uid, { password: pw });
      await admin.auth().revokeRefreshTokens(uid);
      return { ok: true };
    }
    case 'setDisabled': {
      await admin.auth().updateUser(uid, { disabled: !!data.disabled });
      if (data.disabled) await admin.auth().revokeRefreshTokens(uid);
      return { ok: true };
    }
    case 'deleteUser': {
      await admin.auth().deleteUser(uid);
      return { ok: true };
    }
    default:
      throw new HttpsError('invalid-argument', 'Unknown action.');
  }
});
