// Versions of the published legal texts a new account accepts.
// Bump a version whenever the matching page in frontend/ changes.
export const LEGAL_VERSIONS = {
  terms: '2026-11-17',          // frontend/terms.html (offer + content rules)
  personal_data: '2026-11-17'   // frontend/consent.html (152-FZ art. 9 consent)
};

// Both boxes must be ticked explicitly; anything but literal true is a refusal.
export function hasConsent(body) {
  return body?.acceptTerms === true && body?.acceptPersonalData === true;
}

export function recordConsent(db, userId, source) {
  const insert = db.prepare(
    'INSERT INTO legal_acceptances(user_id,document,version,source,accepted_at) VALUES(?,?,?,?,?)'
  );
  const now = Date.now();
  for (const [document, version] of Object.entries(LEGAL_VERSIONS)) insert.run(userId, document, version, source, now);
}

export const CONSENT_ERROR = 'Чтобы создать аккаунт, примите пользовательское соглашение и дайте согласие на обработку персональных данных';
