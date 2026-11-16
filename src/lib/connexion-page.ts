// Les appels de la page de connexion du journal (16/11/2026) : reconnaître
// l'adresse, envoyer le code et le lien, vérifier le code, partir chez Google.
// Règles et textes : connexion-page-pur.ts. Repris de connexion-envoi.ts du site.
//
// Les routes sont sur le MÊME domaine (appel direct, sans CORS) ; le navigateur
// envoie quand même l'en-tête Origin sur un POST, d'où les origines du journal
// dans ORIGINES (connexion-adresse-pur.ts).
// - reconnaitreAdresse : POST /api/connexion/adresse. Tout échec : 'simple'.
// - envoyerCode : POST /api/connexion/envoi (code à 6 chiffres et lien par
//   Resend ; `origine` = cette page, le lien revient sur /auth/lien). Route
//   indisponible : repli sur signInWithOtp de Supabase, comme avant (lien vers
//   /auth/callback, échange PKCE côté serveur).
// - verifierCode : verifyOtp({ email, token, type: 'email' }).
// Démo (NEXT_PUBLIC_CONNEXION_DEMO=1, développement seulement) :
// connexion-demo.ts, aucun appel réseau, aucun email.

import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  issueCode, issueEnvoi, lireEnvoiRoute, lireReconnaissance,
  type Envoi, type IssueCode, type Reconnaissance,
} from '@/lib/connexion-page-pur'

export const ROUTE_ADRESSE = '/api/connexion/adresse'
export const ROUTE_ENVOI = '/api/connexion/envoi'

/**
 * La démo : jamais en production (la condition disparaît du paquet construit).
 * Devant chaque import dynamique de la démo, la condition est écrite en
 * entier : webpack la lit alors comme fausse et ne fabrique même pas le morceau.
 */
export const DEMO = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_CONNEXION_DEMO === '1'

const delai = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined

async function poster(url: string, corps: Record<string, unknown>, ms: number): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
    cache: 'no-store',
    signal: delai(ms),
  })
  if (!r.ok) return null
  return r.json().catch(() => null)
}

/** Ce que l'écosystème sait de l'adresse (une seule réponse). Ne jette pas. */
export async function reconnaitreAdresse(email: string): Promise<Reconnaissance> {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_CONNEXION_DEMO === '1') {
    return (await import('@/lib/connexion-demo')).reconnaitreDemo(email)
  }
  try {
    return lireReconnaissance(await poster(ROUTE_ADRESSE, { email: email.trim() }, 6000))
  } catch {
    return 'simple'
  }
}

export type OptionsEnvoi = {
  /** Chemin de retour après la connexion (lien de l'email). */
  retour?: string | null
  /** Adresse inconnue : le membre a choisi « Créer un compte gratuit ». */
  creer?: boolean
  /** Case « Recevoir les nouvelles fonctionnalités » cochée à la création. */
  newsletter?: boolean
}

/** Envoie le code et le lien de connexion. Ne jette pas. */
export async function envoyerCode(email: string, o: OptionsEnvoi = {}): Promise<Envoi> {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_CONNEXION_DEMO === '1') {
    return (await import('@/lib/connexion-demo')).envoyerDemo()
  }
  const adresse = email.trim()
  let route: Envoi | null = null
  try {
    route = lireEnvoiRoute(await poster(ROUTE_ENVOI, {
      email: adresse,
      creer: o.creer === true,
      newsletter: o.newsletter === true,
      retour: o.retour ?? null,
      // Le lien de l'email revient sur cette page (/auth/lien), si elle est sur la liste blanche.
      origine: window.location.origin,
    }, 15000))
  } catch {
    route = null
  }
  if (route) return route

  // Repli : l'email de Supabase (le lien, comme avant le 16/11).
  try {
    const { error } = await createClient().auth.signInWithOtp({
      email: adresse,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        ...(o.newsletter ? { data: { newsletter_subscribed: true } } : {}),
      },
    })
    const i = issueEnvoi(error)
    if (i.t === 'ok') return { t: 'ok', voie: 'supabase' }
    if (i.t === 'delai') return { t: 'delai', secondes: i.secondes, voie: 'supabase' }
    return i
  } catch {
    return { t: 'erreur', message: '' }
  }
}

/** Vérifie le code tapé. ok : la session est ouverte dans ce navigateur. */
export async function verifierCode(email: string, code: string): Promise<IssueCode & { user?: User | null }> {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_CONNEXION_DEMO === '1') {
    return (await import('@/lib/connexion-demo')).verifierDemo(code)
  }
  try {
    const { data, error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code, type: 'email' })
    if (!error && data.session) return { t: 'ok', user: data.session.user }
    return error ? issueCode(error) : { t: 'erreur' }
  } catch {
    return { t: 'erreur' }
  }
}

/**
 * Part chez Google (même retour qu'avant : /auth/callback). L'adresse
 * pré-choisit le compte Google (login_hint). Rend un message d'erreur, ou null.
 */
export async function continuerAvecGoogle(email?: string | null): Promise<string | null> {
  if (DEMO) return "Démo : Google s'ouvrirait ici."
  try {
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        ...(email ? { queryParams: { login_hint: email.trim() } } : {}),
      },
    })
    return error ? error.message : null
  } catch {
    return 'Google ne répond pas. Réessaie dans un instant.'
  }
}

/**
 * Prévient quand une session s'ouvre dans CE navigateur (lien de l'email ouvert
 * dans un autre onglet). Seul un compte DIFFÉRENT de celui déjà connecté compte.
 * Rend l'arrêt.
 */
export function quandConnecte(f: (user: User) => void): () => void {
  if (DEMO) return () => {}
  let arrete = false
  let desabonner: (() => void) | null = null
  const c = createClient()
  void c.auth.getSession().then(({ data: avant }) => {
    if (arrete) return
    const deja = avant.session?.user.id ?? null
    const { data } = c.auth.onAuthStateChange((evenement, session) => {
      if (evenement === 'SIGNED_IN' && session && session.user.id !== deja) f(session.user)
    })
    desabonner = () => data.subscription.unsubscribe()
  }).catch(() => {})
  return () => { arrete = true; desabonner?.() }
}
