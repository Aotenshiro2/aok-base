// La page de connexion du journal reconnaît l'adresse (16/11/2026, brief
// 2026-11-16-connexion-ecosysteme) : le parcours de aoknowledge.com/connexion
// (14/11/2026), dans le look du journal. La partie PURE : lecture des réponses
// des routes /api/connexion/adresse et /api/connexion/envoi, refus de
// Supabase, textes. Les appels : connexion-page.ts. La page : src/app/auth/page.tsx.
//
// Repris du site (workspace, sites/Aoknowledgecom/v3/src/lib/connexion-adresse.ts
// et lien-connexion.ts), registre « tu » seulement : garder les deux alignés.
//
// Une seule réponse de la route pour une adresse :
//   google     un compte existe avec une identité Google ;
//   connue     un compte existe sans Google, ou un achat attend cette adresse ;
//   inconnue   ni compte ni achat ;
//   rattachee  adresse SECONDAIRE confirmée d'un compte : jamais de second compte ;
//   simple     la route ne répond pas : la page envoie le code (parcours simple).
//
// Aucun import : scripts/verifier-connexion-page.mjs le charge tel quel (Node 22).

export type Porte = 'google' | 'connue' | 'inconnue' | 'rattachee'
export type Reconnaissance = Porte | 'simple'

const PORTES: readonly string[] = ['google', 'connue', 'inconnue', 'rattachee']

/** La réponse de /api/connexion/adresse ({ reponse }) ; tout le reste : 'simple'. */
export function lireReconnaissance(v: unknown): Reconnaissance {
  const r = v && typeof v === 'object' ? (v as { reponse?: unknown }).reponse : null
  return typeof r === 'string' && PORTES.includes(r) ? (r as Porte) : 'simple'
}

/** D'où part l'email : la route (Resend, code et lien) ou Supabase (repli). */
export type Voie = 'aok' | 'supabase'

/**
 * Les modèles d'email de Supabase contiennent-ils le code ? Ne sert qu'au repli
 * (voie « supabase »). Même valeur que CODE_SUPABASE du site.
 */
export const CODE_SUPABASE = false

/** Le résultat d'un envoi, vu par la page. */
export type Envoi =
  | { t: 'ok'; voie: Voie }
  | { t: 'delai'; secondes: number; voie: Voie } // un email vient de partir à cette adresse
  | { t: 'plafond' } // plafond d'envoi (du jour, de l'heure, ou de Supabase)
  | { t: 'rattachee' }
  | { t: 'inconnue' }
  | { t: 'erreur'; message: string }

/** La réponse de /api/connexion/envoi ; null : route indisponible (la page passe au repli). */
export function lireEnvoiRoute(v: unknown): Envoi | null {
  const o = v && typeof v === 'object' ? (v as { envoi?: unknown; secondes?: unknown }) : {}
  switch (o.envoi) {
    case 'ok': return { t: 'ok', voie: 'aok' }
    case 'delai': {
      const n = typeof o.secondes === 'number' && Number.isFinite(o.secondes) ? Math.round(o.secondes) : 60
      return { t: 'delai', secondes: Math.min(3600, Math.max(1, n)), voie: 'aok' }
    }
    case 'plafond':
    case 'limite': return { t: 'plafond' }
    case 'rattachee': return { t: 'rattachee' }
    case 'inconnue': return { t: 'inconnue' }
    case 'invalide': return { t: 'erreur', message: 'invalide' }
    default: return null
  }
}

/** L'email de cette voie contient-il le code à 6 chiffres ? */
export function codeDansEmail(voie: Voie): boolean {
  return voie === 'aok' ? true : CODE_SUPABASE
}

/** Une adresse qui vaut la peine d'être demandée (le serveur revérifie). */
export function adresseValide(email: string): boolean {
  const a = email.trim()
  return a.length >= 6 && a.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)
}

/** Le code tapé ou collé (« Ton code : 123 456 ») : les chiffres seuls, 6 au plus. */
export const LONGUEUR_CODE = 6
export function codeSaisi(texte: string): string {
  return texte.replace(/\D/g, '').slice(0, LONGUEUR_CODE)
}

export type IssueCode = { t: 'ok' } | { t: 'faux' } | { t: 'trop' } | { t: 'erreur' }

type ErreurAuth = { status?: number; code?: string; message?: string } | null | undefined

/**
 * Le refus de verifyOtp. GoTrue rend le même `otp_expired` pour un code faux,
 * expiré ou remplacé par un plus récent.
 */
export function issueCode(e: ErreurAuth): IssueCode {
  if (!e) return { t: 'ok' }
  const message = typeof e.message === 'string' ? e.message : ''
  if (e.status === 429 || /rate limit/i.test(message) || e.code === 'over_request_rate_limit') return { t: 'trop' }
  if (e.code === 'otp_expired' || e.status === 403 || /expired|invalid/i.test(message)) return { t: 'faux' }
  return { t: 'erreur' }
}

// ---------------------------------------------------------------------------
// Refus de Supabase (repli signInWithOtp, mot de passe oublié)
// ---------------------------------------------------------------------------

/** Secondes avant de pouvoir redemander un email à la même adresse (réglage Supabase par défaut). */
export const DELAI_RENVOI_S = 60

export type IssueEnvoiSupabase =
  | { t: 'ok' }
  | { t: 'delai'; secondes: number } // un email vient de partir à cette adresse
  | { t: 'plafond' } // plafond d'envoi du projet atteint
  | { t: 'erreur'; message: string }

/**
 * Le résultat d'un envoi de Supabase, d'après son erreur (null : envoyé).
 * Supabase rend le même code `over_email_send_rate_limit` pour le délai par
 * adresse (« ... after 47 seconds ») et le plafond du projet : le message seul
 * les distingue.
 */
export function issueEnvoi(e: ErreurAuth): IssueEnvoiSupabase {
  if (!e) return { t: 'ok' }
  const message = typeof e.message === 'string' ? e.message : ''
  const n = /after\s+(\d+)\s*seconds?/i.exec(message)
  if (n) return { t: 'delai', secondes: Math.min(3600, Math.max(1, Number(n[1]))) }
  if (/for security purposes/i.test(message)) return { t: 'delai', secondes: DELAI_RENVOI_S }
  if (e.status === 429 || e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit' || /rate limit/i.test(message)) {
    return { t: 'plafond' }
  }
  return { t: 'erreur', message }
}

/** Adresse Gmail (gmail.com, googlemail.com) : « Continuer avec Google » la connecte sans email. */
export function estGmail(email: string): boolean {
  const a = email.trim().toLowerCase()
  const i = a.lastIndexOf('@')
  if (i < 1) return false
  const domaine = a.slice(i + 1)
  return domaine === 'gmail.com' || domaine === 'googlemail.com'
}

/** La clé d'une adresse pour le décompte (même adresse, autre casse : même délai). */
export function cleAdresse(email: string): string {
  return email.trim().toLowerCase()
}

/** Un chemin de retour interne et sûr (mêmes règles que le site et la route), sinon null. */
export function cheminRetourSur(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const chemin = valeur.trim()
  if (!chemin || chemin.length > 300) return null
  if (!chemin.startsWith('/') || chemin.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(chemin)) return null
  if (chemin === '/auth' || chemin.startsWith('/auth/') || chemin.startsWith('/auth?')) return null
  return chemin
}

const TYPES_OTP: readonly string[] = ['magiclink', 'signup', 'recovery', 'email', 'invite']
export type TypeOtp = 'magiclink' | 'signup' | 'recovery' | 'email' | 'invite'

/** Le jeton du lien de l'email (/auth/lien#token_hash=...&type=...), ou null. */
export function lireJetonDuFragment(hash: string): { tokenHash: string; type: TypeOtp } | null {
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const tokenHash = h.get('token_hash') ?? ''
  const type = h.get('type') ?? ''
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash) || !TYPES_OTP.includes(type)) return null
  return { tokenHash, type: type as TypeOtp }
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

/** La sortie « Écris-nous » : l'objet est prérempli, l'adresse du membre n'est JAMAIS dans l'URL. */
export const SUPPORT = 'support@aoknowledge.com'
export const OBJET_SUPPORT = "Je n'arrive pas à me connecter"
export function lienEcrisNous(): string {
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(OBJET_SUPPORT)}`
}

/** Le nom de l'email attendu, selon la voie (objets des modèles, mot pour mot ; SUJET de connexion-adresse-pur.ts). */
export const SUJET_AOK = 'Ton code de connexion AO Knowledge'
export const SUJET_SUPABASE_LIEN = 'Ton lien de connexion AO Knowledge'
export const SUJET_SUPABASE_INSCRIPTION = 'Confirme ton adresse pour entrer chez AO Knowledge'

const S = ' ' // espace insécable entre le nombre et « s »

/** Un email est déjà parti à cette adresse il y a moins d'une minute (restant : décompte en cours). */
export function texteDejaParti(restant: number): string {
  return restant > 0
    ? `Un email vient déjà de partir à cette adresse : ouvre le dernier reçu. Tu pourras en redemander un dans ${restant}${S}s.`
    : 'Un email vient déjà de partir à cette adresse : ouvre le dernier reçu, ou redemandes-en un.'
}

/** Délai par adresse (mot de passe oublié) : un lien est déjà parti. */
export function texteDelai(secondes: number): string {
  return `Un lien vient de partir à cette adresse. Ouvre le dernier email reçu (regarde aussi les indésirables). Tu pourras en redemander un dans ${secondes}${S}s.`
}

/** Plafond global du projet. */
export function textePlafond(): string {
  return 'Les emails de connexion sont très demandés en ce moment. Réessaie dans quelques minutes.'
}

/** Ajouté à chaque message de succès d'un lien : seul le dernier marche. */
export function texteDernierLien(): string {
  return "Seul le dernier lien reçu fonctionne. Pas d'email ? Regarde dans les indésirables."
}

/** Le bouton pendant le décompte. */
export function texteRenvoi(restant: number): string {
  return `Renvoyer dans ${restant}${S}s`
}

export const TEXTES = {
  aide: "Déjà client AOKnowledge (Live Club, formation, Skool...) ? Utilise l'email de ton achat : tes accès s'ouvrent automatiquement.",
  continuer: 'Continuer',
  verification: 'Un instant...',
  motDePasse: 'Se connecter avec un mot de passe',
  avecMotDePasse: 'avec un mot de passe',
  changer: "Changer d'adresse",
  google: {
    titre: 'Ton compte se connecte avec Google.',
    texte: 'Cette adresse est reliée à Google : un clic suffit, sans email à attendre.',
    bouton: 'Continuer avec Google',
    autreCode: 'Recevoir un code par email à la place',
  },
  creerGoogle: {
    titre: 'Crée ton compte avec Google.',
    texte: "C'est une adresse Gmail : Google crée ton compte en un clic, sans email à attendre.",
  },
  boite: {
    titre: 'Regarde ta boîte mail.',
    attente: "Envoi de l'email...",
    envoye: 'Un email vient de partir à',
    attenduAok: `Il vient d'AO Knowledge (${SUPPORT}) et s'appelle « ${SUJET_AOK} ». Pas là ? Regarde dans les indésirables.`,
    attenduSupabase: `Il vient d'AO Knowledge et s'appelle « ${SUJET_SUPABASE_LIEN} » (« ${SUJET_SUPABASE_INSCRIPTION} » la première fois). Pas là ? Regarde dans les indésirables.`,
    codeLabel: "Le code à 6 chiffres de l'email",
    valider: 'Valider',
    verification: 'Vérification...',
    ouLienAok: "Ou clique le bouton de l'email : il te connecte dans le navigateur où il s'ouvre.",
    ouLienSupabase: "Ou clique le bouton de l'email, depuis ce navigateur.",
    lienSeul: "Clique le bouton de l'email, depuis ce navigateur. Sur téléphone, s'il s'ouvre dans ton appli mail sans te connecter, copie le lien et colle-le dans ce navigateur.",
    dernier: 'Seul le dernier email reçu fonctionne.',
    renvoyer: "Renvoyer l'email",
    connecte: "C'est bon, tu es connecté.",
    titrePlafond: "L'email ne peut pas partir pour l'instant.",
    titreErreur: "L'email n'est pas parti.",
    erreurEnvoi: "L'email n'est pas parti. Réessaie dans un instant.",
    adresseInvalide: "Cette adresse n'a pas l'air valide.",
  },
  code: {
    faux: "Ce code ne marche pas : il est faux, il a expiré, ou un email plus récent l'a remplacé. Tape le code du dernier email reçu.",
    trop: "Trop d'essais d'affilée. Attends une minute, puis réessaie.",
    erreur: "La vérification n'a pas abouti. Réessaie dans un instant.",
  },
  plafondGmail: 'Ton adresse est un Gmail : « Continuer avec Google » te connecte tout de suite, sans email.',
  googleGmail: 'Adresse Gmail : tu peux aussi « Continuer avec Google ».',
  ecrisNous: 'Toujours bloqué ? Écris-nous',
  ecrisNousBouton: 'Écris-nous',
  inconnue: {
    titre: 'On ne connaît pas cette adresse.',
    texte: "Tu as payé avec une autre adresse (Skool, PayPal, Stripe) ? Essaie-la d'abord : c'est elle qui ouvre tes accès.",
    essayer: 'Essayer une autre adresse',
    creer: 'Créer un compte gratuit avec cette adresse',
    newsletter: 'Recevoir les nouvelles fonctionnalités et conseils AOKnowledge',
  },
  rattachee: {
    titre: 'Cette adresse est rattachée à un compte.',
    texte: "Elle a été ajoutée à un compte qui se connecte avec une autre adresse, ou avec Google. Connecte-toi comme d'habitude : ce qui passe par cette adresse t'attend sur ce compte.",
    autre: 'Me connecter avec une autre adresse',
  },
  lienExpire: 'Ce lien a expiré ou a déjà servi (seul le dernier email reçu fonctionne). Tape ton adresse : un nouveau code part tout de suite.',
  connexionEchouee: 'La connexion a échoué. Tape ton adresse ci-dessous : un nouveau code part, et tu le tapes ici.',
  motDePasseFaux: 'Ce mot de passe ne correspond pas. Pas de mot de passe, ou un compte Google ? Tape ton adresse en haut et clique « Continuer » : on te reconnaît.',
  oubliSansAdresse: 'Renseigne ton email au-dessus, puis clique « Mot de passe oublié ? ».',
  seConnecter: 'Se connecter',
  oubli: 'Mot de passe oublié ?',
  oubliEnvoye: (adresse: string) => `Lien de réinitialisation envoyé à ${adresse}. Ouvre-le depuis ce navigateur. ${texteDernierLien()}`,
  oubliErreur: "L'email n'est pas parti. Réessaie.",
  ecosysteme: "Compte unique pour tout l'écosystème AOKnowledge",
}

export type Textes = typeof TEXTES

/** Le message d'un envoi de « mot de passe oublié » : le délai par adresse n'est pas le plafond. */
export function messageOubli(issue: IssueEnvoiSupabase, adresse: string): { texte: string; ok: boolean } {
  switch (issue.t) {
    case 'ok': return { ok: true, texte: TEXTES.oubliEnvoye(adresse) }
    case 'delai': return { ok: true, texte: texteDelai(issue.secondes) }
    case 'plafond': return { ok: false, texte: textePlafond() }
    default: return { ok: false, texte: issue.message || TEXTES.oubliErreur }
  }
}
