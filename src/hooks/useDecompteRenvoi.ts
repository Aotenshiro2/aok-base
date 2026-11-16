import { useCallback, useEffect, useState } from 'react'

// Décompte avant de pouvoir redemander un email de connexion (16/11/2026, repris
// du site). Un second envoi annule le premier code et le premier lien : après un
// envoi réussi, ou un refus « délai par adresse », le bouton reste désactivé le
// temps demandé. La minuterie d'une seconde ne tourne QUE pendant le décompte.
// `cle` : l'adresse concernée (le bouton se débloque si l'adresse tapée change).
export function useDecompteRenvoi() {
  const [fin, setFin] = useState<{ a: number; cle: string } | null>(null)
  const [maintenant, setMaintenant] = useState(0)

  useEffect(() => {
    if (!fin) return
    const id = window.setInterval(() => {
      const t = Date.now()
      if (t >= fin.a) setFin(null)
      else setMaintenant(t)
    }, 1000)
    return () => window.clearInterval(id)
  }, [fin])

  const lancer = useCallback((secondes: number, cle = '') => {
    const t = Date.now()
    setMaintenant(t)
    setFin({ a: t + secondes * 1000, cle })
  }, [])

  const restant = fin ? Math.max(0, Math.ceil((fin.a - maintenant) / 1000)) : 0
  return { restant, cle: fin && restant > 0 ? fin.cle : null, lancer }
}
