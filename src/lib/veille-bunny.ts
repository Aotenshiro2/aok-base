// VEILLE BUNNY (21/11/2026) : lit le dernier releve de cockpit_bunny_releves et
// previent l'equipe par Agent AOK (solde bas, ou suivi qui ne lit plus le solde).
// Regles et textes : veille-bunny-pur.ts. Ne jette jamais : une table absente ou
// une alerte ratee ne casse pas le passage quotidien. Le log ne porte que des
// comptes, jamais le texte.
//
// Anti-doublon (comme le resume du matin, cockpit_liveclub_resumes) : chaque
// message reserve sa ligne (jour de Paris, type) dans cockpit_bunny_veille_envois
// AVANT l'envoi, « on conflict do nothing » ; deja la = deja envoye aujourd'hui
// (cron relance, rejeu). Table absente (migration 20261121150000 pas encore
// appliquee) : repli, envoi comme avant (une fois par passage). Envoi rate apres
// reservation : la ligne est retiree pour qu'un passage suivant reessaie.

import { prisma } from '@/lib/db'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import { relationAbsente } from '@/lib/liveclub/pur'
import {
  jourParis, messagesVeilleBunny, type DernierSoldeBunny, type MessageVeilleBunny, type ReleveVeilleBunny,
} from '@/lib/veille-bunny-pur'

export type SyntheseVeilleBunny = {
  lu: boolean; alerte: boolean; panne: boolean; livres: number; deja: number; sansTrace?: boolean
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const court = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)

/** true = a envoyer (ligne reservee, ou table absente : repli). false = deja envoye aujourd'hui. */
async function reserver(jour: string, type: MessageVeilleBunny['type']): Promise<{ envoyer: boolean; trace: boolean }> {
  try {
    const n = await prisma.$executeRaw`
      insert into public.cockpit_bunny_veille_envois (jour, type) values (${jour}::date, ${type})
      on conflict (jour, type) do nothing`
    return { envoyer: n > 0, trace: true }
  } catch (err) {
    if (!relationAbsente(err)) console.warn(`[veille-bunny] trace d'envoi illisible : ${court(err)}`)
    return { envoyer: true, trace: false }
  }
}

async function liberer(jour: string, type: MessageVeilleBunny['type']): Promise<void> {
  try {
    await prisma.$executeRaw`delete from public.cockpit_bunny_veille_envois where jour = ${jour}::date and type = ${type}`
  } catch (err) {
    console.warn(`[veille-bunny] trace d'envoi non retiree : ${court(err)}`)
  }
}

export async function veilleBunny(maintenant: Date = new Date()): Promise<SyntheseVeilleBunny> {
  let releve: ReleveVeilleBunny | null = null
  let dernierSolde: DernierSoldeBunny | null = null
  try {
    const lignes = await prisma.$queryRaw<{
      jour: Date; collecte_le: Date; solde_usd: unknown; jours_avance: unknown; conso_jour_usd: unknown; seuil_jours: number; alerte: boolean | null
    }[]>`
      select jour, collecte_le, solde_usd, jours_avance, conso_jour_usd, seuil_jours, alerte
      from public.cockpit_bunny_releves order by jour desc limit 1`
    const l = lignes[0]
    if (l) {
      releve = {
        jour: l.jour instanceof Date ? l.jour.toISOString().slice(0, 10) : String(l.jour),
        collecte_le: l.collecte_le, solde_usd: num(l.solde_usd), jours_avance: num(l.jours_avance),
        conso_jour_usd: num(l.conso_jour_usd), seuil_jours: l.seuil_jours, alerte: l.alerte,
      }
      const s = await prisma.$queryRaw<{ collecte_le: Date; solde_usd: unknown }[]>`
        select collecte_le, solde_usd from public.cockpit_bunny_releves
        where solde_usd is not null order by jour desc limit 1`
      const solde = s[0] ? num(s[0].solde_usd) : null
      dernierSolde = s[0] && solde !== null ? { collecte_le: s[0].collecte_le, solde_usd: solde } : null
    }
  } catch (err) {
    console.warn(`[veille-bunny] releve illisible : ${court(err)}`)
    return { lu: false, alerte: false, panne: false, livres: 0, deja: 0 }
  }

  const messages = messagesVeilleBunny(releve, dernierSolde, maintenant)
  const synthese: SyntheseVeilleBunny = {
    lu: releve !== null, alerte: messages.some(m => m.type === 'alerte'), panne: messages.some(m => m.type === 'panne'),
    livres: 0, deja: 0,
  }
  const jour = jourParis(maintenant)
  for (const m of messages) {
    const r = await reserver(jour, m.type)
    if (!r.trace) synthese.sansTrace = true
    if (!r.envoyer) { synthese.deja += 1; continue }
    const livres = await alerterEquipeTexte(m.texte, { journal: `[veille-bunny] ${m.type}` })
    if (livres === 0 && r.trace) await liberer(jour, m.type)
    synthese.livres += livres
    console.info(`[veille-bunny] ${m.type}, ${livres} message(s) livre(s)`)
  }
  return synthese
}
