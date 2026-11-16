import { useCallback, useState } from 'react'
import { useDecompteRenvoi } from '@/hooks/useDecompteRenvoi'
import { cleAdresse, DELAI_RENVOI_S, type Envoi } from '@/lib/connexion-page-pur'
import { envoyerCode, type OptionsEnvoi } from '@/lib/connexion-page'

// L'envoi du code de connexion et son décompte (16/11/2026, repris du site).
// Après un envoi réussi, ou un refus « un email vient de partir », « Renvoyer »
// attend le temps demandé (60 s par défaut) pour CETTE adresse : un nouvel
// email annule le code et le lien du précédent.
export type EtatEnvoi = { email: string; envoi: 'attente' | Envoi }

export function useEnvoiCode() {
  const decompte = useDecompteRenvoi()
  const lancer = decompte.lancer
  const [etat, setEtat] = useState<EtatEnvoi | null>(null)

  const envoyer = useCallback(async (email: string, o?: OptionsEnvoi): Promise<Envoi> => {
    const adresse = email.trim()
    setEtat({ email: adresse, envoi: 'attente' })
    const r = await envoyerCode(adresse, o)
    setEtat({ email: adresse, envoi: r })
    if (r.t === 'ok') lancer(DELAI_RENVOI_S, cleAdresse(adresse))
    else if (r.t === 'delai') lancer(r.secondes, cleAdresse(adresse))
    return r
  }, [lancer])

  /** Secondes avant de pouvoir renvoyer à cette adresse (0 : tout de suite). */
  const restant = (email: string) => (decompte.cle === cleAdresse(email) ? decompte.restant : 0)

  /** Un email est-il déjà parti à cette adresse, il y a moins d'une minute ? (Revenir sur l'adresse ne renvoie rien.) */
  const dejaParti = (email: string) =>
    restant(email) > 0 && etat !== null && cleAdresse(etat.email) === cleAdresse(email) && etat.envoi !== 'attente'

  return { etat, envoyer, restant, dejaParti }
}
