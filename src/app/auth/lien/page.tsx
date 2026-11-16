'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cheminRetourSur, lireJetonDuFragment } from '@/lib/connexion-page-pur'

// Le lien de l'email de connexion du journal (16/11/2026, envoyé par la route
// /api/connexion/envoi) : /auth/lien?retour=<chemin>#token_hash=<...>&type=<...>.
// Même mécanique que la page /auth/lien du site : verifyOtp({ token_hash, type })
// ouvre la session dans CE navigateur, sans PKCE. Le lien marche donc aussi
// quand le téléphone l'ouvre dans l'appli mail, ou sur un autre appareil que
// celui qui l'a demandé. Le fragment sort tout de suite de la barre d'adresse
// et de l'historique. Échec (lien expiré, déjà servi, remplacé par un email plus
// récent) : /auth?error=lien_expire, qui le dit. Page publique (middleware : /auth).
export default function AuthLienPage() {
  // Le mode strict de React lance l'effet deux fois en dev : le jeton ne sert qu'une fois.
  const lance = useRef(false)

  useEffect(() => {
    if (lance.current) return
    lance.current = true
    const lu = lireJetonDuFragment(window.location.hash)
    const retour = cheminRetourSur(new URLSearchParams(window.location.search).get('retour'))
    if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname)
    // Navigation complète : les pages du serveur relisent la session (cookies) dès l'arrivée.
    const aller = (chemin: string) => window.location.replace(chemin)
    const echec = () => aller('/auth?error=lien_expire' + (retour ? `&redirectTo=${encodeURIComponent(retour)}` : ''))
    const supabase = createClient()

    if (!lu) {
      // Page rechargée (fragment déjà retiré) : déjà connecté, on continue ; sinon le lien ne vaut rien.
      supabase.auth.getSession()
        .then(({ data }) => (data.session ? aller(retour ?? '/') : echec()))
        .catch(echec)
      return
    }
    supabase.auth.verifyOtp({ token_hash: lu.tokenHash, type: lu.type })
      .then(({ data, error }) => (!error && data.session ? aller(retour ?? '/') : echec()))
      .catch(echec)
  }, [])

  return (
    <div
      className="dark"
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        background: 'radial-gradient(130% 120% at 50% 6%, #121214 0%, #050506 55%, #000000 100%)',
      }}
    >
      <span className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'rgba(252, 223, 62, 0.35)', borderTopColor: 'transparent' }} />
      <p className="text-sm" style={{ color: 'var(--node-meta)' }}>Connexion en cours...</p>
    </div>
  )
}
