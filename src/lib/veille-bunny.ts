// VEILLE BUNNY (21/11/2026) : lit le dernier releve de cockpit_bunny_releves et
// previent l'equipe par Agent AOK s'il est en alerte. Regles et texte :
// veille-bunny-pur.ts. Ne jette jamais : une table absente (migration
// 20261121100000 pas encore appliquee) ou une alerte ratee ne casse pas le
// passage quotidien. Le log ne porte que des comptes, jamais le texte.

import { prisma } from '@/lib/db'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import { texteAlerteBunny, type ReleveVeilleBunny } from '@/lib/veille-bunny-pur'

export type SyntheseVeilleBunny = { lu: boolean; alerte: boolean; livres: number }

export async function veilleBunny(maintenant: Date = new Date()): Promise<SyntheseVeilleBunny> {
  let releve: ReleveVeilleBunny | null = null
  try {
    const lignes = await prisma.$queryRaw<{
      jour: Date; collecte_le: Date; solde_usd: unknown; jours_avance: unknown; conso_jour_usd: unknown; seuil_jours: number; alerte: boolean | null
    }[]>`
      select jour, collecte_le, solde_usd, jours_avance, conso_jour_usd, seuil_jours, alerte
      from public.cockpit_bunny_releves order by jour desc limit 1`
    const l = lignes[0]
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    if (l) {
      releve = {
        jour: l.jour instanceof Date ? l.jour.toISOString().slice(0, 10) : String(l.jour),
        collecte_le: l.collecte_le, solde_usd: num(l.solde_usd), jours_avance: num(l.jours_avance),
        conso_jour_usd: num(l.conso_jour_usd), seuil_jours: l.seuil_jours, alerte: l.alerte,
      }
    }
  } catch (err) {
    console.warn(`[veille-bunny] releve illisible : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return { lu: false, alerte: false, livres: 0 }
  }
  const texte = texteAlerteBunny(releve, maintenant)
  if (!texte) return { lu: releve !== null, alerte: false, livres: 0 }
  const livres = await alerterEquipeTexte(texte, { journal: '[veille-bunny] alerte' })
  console.info(`[veille-bunny] alerte solde bas, ${livres} message(s) livre(s)`)
  return { lu: true, alerte: true, livres }
}
