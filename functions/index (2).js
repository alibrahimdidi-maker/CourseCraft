// RASFAHI - server helper (Firebase Cloud Functions)
//  1. rasfahiAdmin              - lets the Admin set a user's password, lock/unlock a login, delete a login.
//  2. rasfahiAssignmentEmails   - e-mails the lecturer when a task is assigned, sent for amendment,
//                                 and a thank-you when they press "All Done".
//  3. rasfahiDeadlineReminders  - every morning (Maldives time): reminder the day before the deadline,
//                                 and a reminder once the deadline has passed without the task being finished.
//
// E-mails are queued in the Firestore collection "mail". The official Firebase extension
// "Trigger Email from Firestore" (firebase/firestore-send-email) delivers them through your SMTP
// account (for example the IUM Microsoft 365 mailbox). See the setup notes in the reply.
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

const ADMIN_EMAILS = ['alibrahimdidi@gmail.com'];
const MAIL_COLLECTION = 'mail';
const APP_URL = '';                 // optional: the web address of RASFAHI, e.g. 'https://example.github.io/rasfahi/'
const TIME_ZONE = 'Indian/Maldives';
const { HttpsError } = functions.https;

const FACULTY_NAMES = {
  KSL: "Kulliyyah of Shari'ah and Law", KOE: 'Kulliyyah of Education', KEMS: 'Kulliyyah of Economics and Management Studies',
  KIRKHS: 'Kulliyyah of Islamic Revealed Knowledge and Human Sciences', KQS: 'Kulliyyah of Quran & Sunnah',
  KAL: 'Kulliyyah of Arabic Language', CCE: 'Centre for Continuing Education', CPS: 'Centre for Postgraduate Studies'
};
function facultyName(id) { return FACULTY_NAMES[id] || id || 'the faculty'; }

// ------------------------------------------------------------------ 1. admin helper
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

// ------------------------------------------------------------------ e-mail helpers
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dayInMaldives(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); // YYYY-MM-DD
}
function prettyDay(day) {
  if (!day) return '-';
  const d = new Date(day + 'T00:00:00Z');
  return isNaN(d) ? day : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Dhivehi + English texts for each kind of e-mail.
const TEXTS = {
  assigned: {
    subject: a => `Module outline assigned: ${a.moduleCode} | މޮޑިއުލް އައުޓްލައިނެއް ޙަވާލުކުރެވިއްޖެ`,
    dv: a => `ތިރީގައިވާ މޮޑިއުލްގެ އައުޓްލައިން ތައްޔާރުކުރުމުގެ މަސައްކަތް ތިޔަބޭފުޅާއާ ޙަވާލުކުރެވިއްޖެއެވެ. RASFAHI އަށް ވަދެ "My Tasks" އިން މަސައްކަތް ފައްޓަވާލެއްވުން އެދެމެވެ.`,
    en: a => `The preparation of the following module outline has been assigned to you. Please sign in to RASFAHI and start the task from "My Tasks".`
  },
  dayBefore: {
    subject: a => `Reminder: ${a.moduleCode} outline is due tomorrow | ހަނދާންކޮށްދިނުން: މާދަމާއަކީ ނިންމަންޖެހޭ ދުވަސް`,
    dv: a => `${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން ނިންމަންޖެހޭ ތާރީޚަކީ މާދަމާ، ${prettyDay(a.dueAt)} އެވެ. މަސައްކަތް ނިންމަވައި "All Done" އަށް ފިތާލެއްވުން އެދެމެވެ.`,
    en: a => `This is a friendly reminder that the outline for ${a.moduleName} (${a.moduleCode}) is due tomorrow, ${prettyDay(a.dueAt)}. Please complete it and press "All Done".`
  },
  overdue: {
    subject: a => `Deadline reached: ${a.moduleCode} outline not yet completed | ނިންމަންޖެހޭ ތާރީޚް ހަމަވެއްޖެ`,
    dv: a => `${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން ނިންމަންޖެހޭ ތާރީޚް، ${prettyDay(a.dueAt)} ހަމަވެއްޖެ ނަމަވެސް، މަސައްކަތް އަދި ފުރިހަމަވެފައެއް ނުވެއެވެ. ވީހާ އަވަހަކަށް ނިންމަވައި "All Done" އަށް ފިތާލައްވައިދެއްވުން އެދެމެވެ.`,
    en: a => `The deadline for the ${a.moduleName} (${a.moduleCode}) outline (${prettyDay(a.dueAt)}) has passed, but the task is not yet complete. Please complete it as soon as possible and press "All Done".`
  },
  thanks: {
    subject: a => `Thank you - ${a.moduleCode} outline received | ޝުކުރިއްޔާ`,
    dv: a => `${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން ފުރިހަމަކޮށް ހުށަހަޅުއްވައިދެއްވީތީ ވަރަށް ބޮޑަށް ޝުކުރިއްޔާ. ތިޔަބޭފުޅާގެ މަސައްކަތް ލިބިއްޖެއެވެ.`,
    en: a => `Thank you for completing and submitting the outline for ${a.moduleName} (${a.moduleCode}). Your work has been received.`
  },
  toCurriculum: {
    subject: a => `For Curriculum review: ${a.moduleCode} (${a.facultyId || ''}) | ކަރިކިއުލަމް ރިވިއުއަށް`,
    dv: a => `${facultyName(a.facultyId)} އިން ${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން ޑީން އެޕްރޫވްކޮށް، ކަރިކިއުލަމް ރިވިއުއަށް ފޮނުވާފައިވެއެވެ. RASFAHI ގެ "Curriculum Review" އިން ބައްލަވާލެއްވުން އެދެމެވެ.`,
    en: a => `The Dean of the ${facultyName(a.facultyId)} has approved the outline for ${a.moduleName} (${a.moduleCode}) and sent it to the Curriculum Department for review. Please see "Curriculum Review" in RASFAHI.`
  },
  returnedToFaculty: {
    subject: a => `Returned to faculty: ${a.moduleCode} outline | ފެކަލްޓީއަށް އަނބުރާ ފޮނުވިއްޖެ`,
    dv: a => `${a.returnSource === 'mqa' ? 'އެމް.ކިއު.އޭ ގެ ކޮމެންޓްތަކުގެ އަލީގައި' : 'ކަރިކިއުލަމް ރިވިއުއަށްފަހު'}، ${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިނަށް ބަދަލުތަކެއް ގެނައުމަށް ފެކަލްޓީއަށް އަނބުރާ ފޮނުވާފައިވެއެވެ. RASFAHI ގެ "Faculty Approvals" އިން ލެކްޗަރަރަށް ފޮނުއްވައިދެއްވުން އެދެމެވެ.`,
    en: a => `${a.returnSource === 'mqa' ? 'Following MQA comments' : 'Following curriculum review'}, the outline for ${a.moduleName} (${a.moduleCode}) has been returned to the faculty for amendment. Please send it to the lecturer from "Faculty Approvals" in RASFAHI.`
  },
  sentToMqa: {
    subject: a => `Sent to MQA: ${a.moduleCode} outline | އެމް.ކިއު.އޭ އަށް ފޮނުވިއްޖެ`,
    dv: a => `${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން ކަރިކިއުލަމް ޑިޕާޓްމަންޓުން އެމް.ކިއު.އޭ އަށް ފޮނުވާފައިވެއެވެ.`,
    en: a => `The Curriculum Department has sent the outline for ${a.moduleName} (${a.moduleCode}) to MQA.`
  },
  approved: {
    subject: a => `MQA approved: ${a.moduleCode} outline | އެމް.ކިއު.އޭ އިން އެޕްރޫވްކޮށްފި`,
    dv: a => `${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިން އެމް.ކިއު.އޭ އިން އެޕްރޫވްކޮށްފިއެވެ. ތިޔަބޭފުޅުންގެ މަސައްކަތަށް ވަރަށް ބޮޑަށް ޝުކުރިއްޔާ.`,
    en: a => `The outline for ${a.moduleName} (${a.moduleCode}) has been approved by MQA. Thank you for your work.`
  },
  amend: {
    subject: a => `Amendment requested: ${a.moduleCode} outline | ބަދަލުތަކެއް ގެނައުމަށް އެދިފައި`,
    dv: a => `ކަރިކިއުލަމް ރިވިއުއަށްފަހު، ${a.moduleName} (${a.moduleCode}) ގެ އައުޓްލައިނަށް ބަދަލުތަކެއް ގެނައުމަށް އެދިފައިވެއެވެ. އައުޓްލައިން ބަދަލުކުރެވޭނެ ގޮތަށް ހުޅުވާލެވިއްޖެއެވެ. ބަދަލުތައް ގެނައުމަށްފަހު އަލުން "All Done" އަށް ފިތާލައްވާ.`,
    en: a => `Following curriculum review, amendments have been requested for the ${a.moduleName} (${a.moduleCode}) outline. It has been unlocked for editing. When the changes are made, please press "All Done" again.`
  }
};

function buildEmail(kind, a, greetName) {
  const T = TEXTS[kind];
  const name = greetName !== undefined ? greetName : ((a.submission && a.submission.name) || a.lecturerName || '');
  const rowsDv = [['މޮޑިއުލް', a.moduleName], ['ކޯޑު', a.moduleCode], ['ކޮންޓެކްޓް އަވަރސް', a.contactHours || '-'], ['ޙަވާލުކުރި ތާރީޚް', prettyDay(a.assignedAt)], ['ނިންމަންޖެހޭ ތާރީޚް', prettyDay(a.dueAt)]];
  const rowsEn = [['Module', a.moduleName], ['Code', a.moduleCode], ['Contact hours', a.contactHours || '-'], ['Assigned on', prettyDay(a.assignedAt)], ['Due by', prettyDay(a.dueAt)]];
  const table = (rows, rtl) => `<table style="border-collapse:collapse; width:100%; margin:12px 0; font-size:14px;" dir="${rtl ? 'rtl' : 'ltr'}">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px; background:#eef2ff; color:#1e3a8a; font-weight:bold; width:40%; border:1px solid #dbe2f5;">${esc(k)}</td><td style="padding:6px 10px; border:1px solid #dbe2f5;">${esc(v)}</td></tr>`).join('')}</table>`;
  const noteDv = kind === 'amend' && a.amendNote ? `<p style="background:#fff7ed; border-right:4px solid #f97316; padding:10px; white-space:pre-wrap;"><b>ގެންނަންޖެހޭ ބަދަލުތައް:</b><br>${esc(a.amendNote)}</p>` : '';
  const noteEn = kind === 'amend' && a.amendNote ? `<p style="background:#fff7ed; border-left:4px solid #f97316; padding:10px; white-space:pre-wrap;"><b>Requested changes:</b><br>${esc(a.amendNote)}</p>` : '';
  const link = APP_URL ? `<p style="text-align:center; margin:18px 0;"><a href="${esc(APP_URL)}" style="background:#065f46; color:#fff; padding:10px 22px; border-radius:6px; text-decoration:none; font-weight:bold;">Open RASFAHI</a></p>` : '';
  const html = `<div style="background:#f1f5f9; padding:24px; font-family:Segoe UI, Arial, sans-serif;">
    <div style="max-width:640px; margin:auto; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
      <div style="background:linear-gradient(135deg,#0b1f4d,#1e3a8a 60%,#065f46); color:#fff; padding:20px 24px; border-bottom:4px solid #c9a227;">
        <div style="font-size:22px; font-weight:bold; letter-spacing:2px;">RASFAHI</div><div style="opacity:.85;">MNQF Program Builder · Islamic University of Maldives</div></div>
      <div dir="rtl" style="padding:20px 24px; font-family:Faruma, 'MV Faseyha', 'MV Waheed', Tahoma, sans-serif; font-size:16px; line-height:1.9; text-align:right;">
        <p>${name ? 'އިޙްތިރާމް ލިބިވަޑައިގެންނެވި ' + esc(name) + '،' : 'އިޙްތިރާމް ލިބިވަޑައިގެންނެވި ބޭފުޅާ،'}</p><p>${esc(T.dv(a))}</p>${noteDv}${table(rowsDv, true)}</div>
      <hr style="border:none; border-top:1px solid #e2e8f0; margin:0 24px;">
      <div style="padding:20px 24px; font-size:15px; line-height:1.6; color:#0f172a;">
        <p>Dear ${name ? esc(name) : 'colleague'},</p><p>${esc(T.en(a))}</p>${noteEn}${table(rowsEn, false)}${link}
        <p style="color:#64748b; font-size:12px;">This is an automatic message from RASFAHI. Please do not reply to this e-mail.</p></div>
    </div></div>`;
  const text = `${T.en(a)}\n\nModule: ${a.moduleName} (${a.moduleCode})\nDue by: ${prettyDay(a.dueAt)}${kind === 'amend' && a.amendNote ? '\n\nRequested changes:\n' + a.amendNote : ''}`;
  return { subject: T.subject(a), html, text };
}

// E-mail addresses of active accounts with a role (optionally within one faculty).
async function emailsFor(role, facultyId) {
  const snap = await admin.firestore().collection('rasfahi_accounts').where('role', '==', role).get();
  return snap.docs.map(d => d.data()).filter(x => x.email && !x.deleted && !x.disabled && (!facultyId || x.facultyId === facultyId)).map(x => x.email);
}

async function queueMailTo(kind, a, assignmentId, to) {
  const list = Array.from(new Set((to || []).filter(Boolean)));
  if (!list.length) return;
  const msg = buildEmail(kind, a, list.length === 1 && list[0] === a.lecturerEmail ? undefined : '');
  await admin.firestore().collection(MAIL_COLLECTION).add({ to: list, message: msg, rasfahi: { kind, assignmentId, createdAt: new Date().toISOString() } });
}

async function queueMail(kind, a, assignmentId) {
  if (!a.lecturerEmail) return;
  const msg = buildEmail(kind, a);
  await admin.firestore().collection(MAIL_COLLECTION).add({
    to: [a.lecturerEmail],
    message: msg,
    rasfahi: { kind, assignmentId, createdAt: new Date().toISOString() }
  });
}

// ------------------------------------------------------------------ 2. event e-mails
exports.rasfahiAssignmentEmails = functions.firestore.document('rasfahi_assignments/{id}').onWrite(async (change, context) => {
  const before = change.before.exists ? change.before.data() : null;
  const after = change.after.exists ? change.after.data() : null;
  if (!after) return null;
  const id = context.params.id;

  if (!before && after.status === 'assigned') await queueMail('assigned', after, id);
  if (before && before.status !== after.status) {
    if (after.status === 'submitted') await queueMail('thanks', after, id);
    if (after.status === 'amend') await queueMail('amend', after, id);
  }
  // Faculty -> Curriculum -> MQA -> Approved workflow.
  const s0 = before ? (before.stage || 'faculty') : 'faculty', s1 = after.stage || 'faculty';
  if (before && s0 !== s1) {
    const deans = await emailsFor('dean', after.facultyId);
    if (s1 === 'curriculum') await queueMailTo('toCurriculum', after, id, await emailsFor('curriculum'));
    if (s1 === 'faculty_amend') await queueMailTo('returnedToFaculty', after, id, deans);
    if (s1 === 'mqa') await queueMailTo('sentToMqa', after, id, deans.concat([after.lecturerEmail]));
    if (s1 === 'approved') await queueMailTo('approved', after, id, deans.concat([after.lecturerEmail]));
  }
  // Deadline moved: allow the reminders to be sent again for the new date.
  if (before && before.dueAt !== after.dueAt && after.reminders && (after.reminders.dayBefore || after.reminders.overdue)) {
    await change.after.ref.update({ reminders: { dayBefore: false, overdue: false } });
  }
  return null;
});

// ------------------------------------------------------------------ 3. daily deadline reminders
exports.rasfahiDeadlineReminders = functions.pubsub.schedule('0 8 * * *').timeZone(TIME_ZONE).onRun(async () => {
  const today = dayInMaldives(0);
  const tomorrow = dayInMaldives(1);
  const snap = await admin.firestore().collection('rasfahi_assignments').where('status', 'in', ['assigned', 'started', 'amend']).get();
  const jobs = [];
  snap.forEach(doc => {
    const a = doc.data();
    if (!a.dueAt) return;
    const r = a.reminders || {};
    if (a.dueAt === tomorrow && !r.dayBefore) {
      jobs.push(queueMail('dayBefore', a, doc.id).then(() => doc.ref.update({ 'reminders.dayBefore': true })));
    } else if (a.dueAt < today && !r.overdue) {
      jobs.push(queueMail('overdue', a, doc.id).then(() => doc.ref.update({ 'reminders.overdue': true })));
    }
  });
  await Promise.all(jobs);
  return null;
});
