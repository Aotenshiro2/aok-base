'use client'

import { useEffect, useRef, useState } from 'react'
import { CadreConnexion } from '@/components/connexion/Cadre'
import { S, Tourne } from '@/components/connexion/Ecrans'
import {
  ECRIS_NOUS_CARNET, LENT, TEXTES_CARNET, lienEcrisNousCarnet, lireLienCarnet, transmettreAuCarnet,
  type IssueCarnet, type MessageCarnet,
} from '@/lib/connexion-carnet-pur'

// La page de retour du lien de l'email pour le Carnet du Trader (16/11/2026) :
// /auth/carnet#token_hash=<...>&type=<...> (ou ?code= pour le repli de Supabase).
// Le lien des origines de l'extension revient ici (ORIGINES de
// connexion-adresse-pur.ts) : un lien d'email ne s'ouvre pas dans une extension.
// La page ne vérifie PAS le jeton et ne connecte jamais le journal : elle le
// passe au Carnet par chrome.runtime.sendMessage (externally_connectable du
// manifest du Carnet), qui le vérifie pour avoir sa propre session. Règles et
// textes : connexion-carnet-pur.ts. Le fragment sort tout de suite de la barre
// d'adresse et de l'historique ; le jeton n'est jamais journalisé.
// Page publique (middleware : préfixe /auth).

/** chrome.runtime tel qu'une page web le voit (présent seulement si une extension accepte cette page). */
type RuntimeWeb = {
  sendMessage?: (id: string, message: unknown, rappel: (reponse: unknown) => void) => void
  lastError?: unknown
}

/** Le Carnet a reçu le message mais ne répond pas : au-delà, la page le dit (sa vérification peut encore aboutir). */
const ATTENTE_MAX_MS = 20000

function envoyerAuCarnet(id: string, message: MessageCarnet): Promise<unknown> {
  return new Promise(resoudre => {
    const runtime = (window as unknown as { chrome?: { runtime?: RuntimeWeb } }).chrome?.runtime
    if (!runtime?.sendMessage) { resoudre(null); return }
    let fini = false
    const minuterie = window.setTimeout(() => { if (!fini) { fini = true; resoudre(LENT) } }, ATTENTE_MAX_MS)
    try {
      runtime.sendMessage(id, message, reponse => {
        // Lire lastError dans le rappel : extension absente, ou message refusé par sa garde (pas de réponse).
        const absente = Boolean(runtime.lastError)
        if (fini) return
        fini = true
        window.clearTimeout(minuterie)
        resoudre(absente ? null : reponse ?? null)
      })
    } catch {
      fini = true
      window.clearTimeout(minuterie)
      resoudre(null)
    }
  })
}

/** Démo (NEXT_PUBLIC_CONNEXION_DEMO=1, développement seulement) : ?carnet=ok|absente|expire|pas-attendu|autre-compte|trop|erreur|lent. */
async function envoyerDemo(): Promise<unknown> {
  await new Promise(r => setTimeout(r, 600))
  const c = new URLSearchParams(window.location.search).get('carnet') ?? 'ok'
  if (c === 'ok') return { ok: true }
  if (c === 'lent') return LENT
  if (c === 'absente') return null
  return { ok: false, raison: c }
}

export default function AuthCarnetPage() {
  const [etat, setEtat] = useState<'envoi' | IssueCarnet>('envoi')
  // Le mode strict de React lance l'effet deux fois en dev : le jeton ne part qu'une fois.
  const lance = useRef(false)

  useEffect(() => {
    if (lance.current) return
    lance.current = true
    const demande = lireLienCarnet(window.location.hash, window.location.search)
    const demo = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_CONNEXION_DEMO === '1'
    const envoyer = demo ? (() => envoyerDemo()) : envoyerAuCarnet
    if (demo) {
      // La démo garde ?carnet= pour qu'on puisse recharger la page ; le fragment sort quand même.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } else if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    if (!demande) { setEtat('invalide'); return }
    void transmettreAuCarnet(demande, envoyer).then(setEtat)
  }, [])

  const t = TEXTES_CARNET[etat]
  const reussi = etat === 'ok'

  return (
    <CadreConnexion>
      <div className="space-y-4" aria-live="polite">
        <h2 className="text-base font-semibold" style={S.titre}>
          {etat === 'envoi' && <><Tourne clair />{' '}</>}
          {t.titre}
        </h2>
        <p className={`text-sm leading-relaxed break-words ${reussi ? 'text-green-500' : ''}`} style={reussi ? undefined : S.texte}>
          {t.texte}
        </p>
        {etat !== 'envoi' && !reussi && (
          <p className="pt-4 mt-2 text-center" style={{ borderTop: '1px solid var(--float-border)' }}>
            <a href={lienEcrisNousCarnet()} className="text-xs underline underline-offset-4" style={S.lien}>{ECRIS_NOUS_CARNET}</a>
          </p>
        )}
      </div>
    </CadreConnexion>
  )
}
