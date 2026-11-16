// Démo de la page de connexion (NEXT_PUBLIC_CONNEXION_DEMO=1, développement
// seulement, chargée par import dynamique : absente du paquet construit).
// Aucun appel réseau, aucun email. Reprise de connexion-demo.ts du site.
//
// Réglages dans l'adresse de la page :
//   ?adresse=google|connue|inconnue|rattachee|simple   la réponse de la route
//     (sans réglage : un mot de la partie avant « @ » la donne, par exemple
//     marie.google@gmail.com, sinon « connue ») ;
//   ?envoi=delai|plafond|erreur|rattachee|inconnue     l'issue de l'envoi ;
//   ?voie=supabase                                      le repli (lien Supabase).
// Le code juste de la démo : 123456 (000000 : trop d'essais).

import type { User } from '@supabase/supabase-js'
import type { Envoi, IssueCode, Reconnaissance } from '@/lib/connexion-page-pur'

const param = (k: string) => new URLSearchParams(window.location.search).get(k)
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
const REPONSES: readonly Reconnaissance[] = ['google', 'rattachee', 'inconnue', 'connue', 'simple']

export async function reconnaitreDemo(email: string): Promise<Reconnaissance> {
  await pause(700) // le délai fixe de la route
  const force = param('adresse')
  const r = REPONSES.find(x => x === force)
  if (r) return r
  const local = email.trim().toLowerCase().split('@')[0] ?? ''
  return REPONSES.find(x => local.includes(x)) ?? 'connue'
}

export async function envoyerDemo(): Promise<Envoi> {
  await pause(500)
  const voie = param('voie') === 'supabase' ? 'supabase' : 'aok'
  switch (param('envoi')) {
    case 'delai': return { t: 'delai', secondes: 47, voie }
    case 'plafond': return { t: 'plafond' }
    case 'erreur': return { t: 'erreur', message: '' }
    case 'rattachee': return { t: 'rattachee' }
    case 'inconnue': return { t: 'inconnue' }
    default: return { t: 'ok', voie }
  }
}

export async function verifierDemo(code: string): Promise<IssueCode & { user?: User | null }> {
  await pause(400)
  if (code === '123456') return { t: 'ok', user: { id: 'demo', user_metadata: {} } as unknown as User }
  if (code === '000000') return { t: 'trop' }
  return { t: 'faux' }
}
