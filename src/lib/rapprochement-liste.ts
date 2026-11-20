// LE RAPPROCHEMENT D'UNE LISTE, cote serveur (21/11/2026). Regles dans
// rapprochement-liste-pur.ts.
//
// Un seul appelant : l'outil de LECTURE rapprocher_liste de l'agent du
// Cockpit (agent-cockpit.ts), servi a l'equipe seulement, comme fiche_personne.
// Pour CHAQUE personne, le meme recoupement que la fiche : resoudrePersonne
// (fiche-personne.ts), appele tel quel, avec le meme verrou du fonds
// d'archive (fonds: false = aucun noeud d'archive). Rien n'est recopie : ce
// fichier n'ajoute que la lecture par lot de ce qu'il faut pour ECRIRE la
// ligne (noms des fiches, comptes Telegram, emails des fiches, noms affiches).
//
// Une fiche sans compte apres sa resolution est relue par ses emails
// (resoudrePersonne sur chacun) : un acces broker, un fil Support ou un
// rattachement poses par email sans fiche, que la resolution par la fiche ne
// suit pas. Puis, s'il ne reste rien, les candidats par le nom.
//
// Lecture seule : des transactions READ ONLY (8 s par requete), par paquets,
// sous une limite de temps ; ce qui n'a pas ete traite est dit.

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { lireQui, type Groupe, type QuiLu } from '@/lib/fiche-personne-pur'
import { resoudrePersonne } from '@/lib/fiche-personne'
import {
  POPULATIONS, candidatsParNom, comptesDuGroupe, indexerNoms, lignePersonne, lireEntreeListe, probablesDuGroupe,
  reponseListe, type CompteLu, type EntreeListe, type FaitsPersonne, type LignePersonne, type NomAffiche,
} from '@/lib/rapprochement-liste-pur'

type Tx = Prisma.TransactionClient

const PAQUET = 25
const DUREE_MAX_MS = 50000
const VIVANT = `('active','past_due','unpaid','trialing','paused')`

async function lire<T>(f: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
    return f(tx)
  }, { maxWait: 5000, timeout: 30000 })
}

/** Une personne a resoudre : ce qu'on a donne, ou une fiche de la population. */
type Item = { entree: string | null; qui: QuiLu | null }

/**
 * La personne retenue parmi les groupes rendus. Un seul groupe : c'est elle.
 * Plusieurs : s'il n'y a qu'UNE fiche membre parmi eux, c'est elle, et les
 * autres groupes porteurs d'un compte sont des candidats par le nom ; sinon
 * « plusieurs ».
 */
function choisir(groupes: Groupe[]): { personne: Groupe | null; autres: Groupe[] } {
  if (groupes.length === 1) return { personne: groupes[0], autres: [] }
  const fiches = groupes.filter((g) => g.noeuds.some((n) => n.startsWith('membre:')))
  if (fiches.length === 1) return { personne: fiches[0], autres: groupes.filter((g) => g !== fiches[0]) }
  if (fiches.length === 0) {
    const avecCompte = groupes.filter((g) => g.noeuds.some((n) => n.startsWith('tg:')))
    if (avecCompte.length === 1) return { personne: avecCompte[0], autres: [] }
  }
  return { personne: null, autres: groupes }
}

type Resolu = { item: Item; statut: FaitsPersonne['statut']; groupe: Groupe | null; nbPersonnes?: number; candidatsTg: number[] }

/** Resout les items d'un paquet, chacun par resoudrePersonne. */
async function resoudrePaquet(tx: Tx, items: Item[], fonds: boolean): Promise<Resolu[]> {
  const r: Resolu[] = []
  for (const item of items) {
    if (!item.qui) { r.push({ item, statut: 'illisible', groupe: null, candidatsTg: [] }); continue }
    const res = await resoudrePersonne(tx, item.qui, { candidats: false, fonds })
    if (res.statut === 'aucun') { r.push({ item, statut: 'aucun', groupe: null, candidatsTg: [] }); continue }
    if (res.statut === 'un') { r.push({ item, statut: 'un', groupe: res.groupe, candidatsTg: [] }); continue }
    const { personne, autres } = choisir(res.groupes)
    const candidatsTg = autres.flatMap((g) => comptesDuGroupe(g).durs.concat(comptesDuGroupe(g).parNom.map((id) => ({ id, voie: 'candidat_nom' as const }))).map((x) => x.id))
    if (personne) r.push({ item, statut: 'un', groupe: personne, candidatsTg })
    else r.push({ item, statut: 'plusieurs', groupe: null, nbPersonnes: res.groupes.length, candidatsTg: [] })
  }
  return r
}

/** La population nommee : les fiches membres, en items. */
async function itemsDeLaPopulation(tx: Tx, population: keyof typeof POPULATIONS): Promise<Item[]> {
  const vivant = population === 'membres_live_club'
  const l = await tx.$queryRawUnsafe<{ id: string }[]>(`
    select m.membre_id::text as id
    from public.cockpit_membres m
    join public.cockpit_abonnements a on a.membre_id = m.membre_id and a.offre_id = 'live-club'
    group by m.membre_id
    having bool_or(a.statut in ${VIVANT}) = $1
    order by 1`, vivant)
  return l.map((x) => ({ entree: null, qui: { genre: 'membre', id: x.id } }))
}

const uniques = <T>(l: T[]) => [...new Set(l)]

/**
 * Le rapprochement : la reponse au modele (JSON borne) et le nombre de lignes
 * rendues. Ne leve jamais : une panne revient en JSON, sans donnee.
 */
export async function rapprocherListePourAgent(entree: unknown, o: { fonds: boolean; dureeMaxMs?: number }): Promise<{ texte: string; lignes: number }> {
  const lu = lireEntreeListe(entree)
  if ('erreur' in lu) return { texte: JSON.stringify({ statut: 'erreur', erreur: lu.erreur }), lignes: 0 }
  try {
    return await rapprocher(lu, o)
  } catch (err) {
    const raison = err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)
    console.error(`[cockpit/liste] rapprochement impossible : ${raison.slice(0, 200)}`)
    return { texte: JSON.stringify({ statut: 'erreur', erreur: `Rapprochement impossible (${raison.slice(0, 160)}) : réessaie dans un instant, ou découpe la liste.` }), lignes: 0 }
  }
}

export async function rapprocher(lu: EntreeListe, o: { fonds: boolean; dureeMaxMs?: number }): Promise<{ texte: string; lignes: number; resultats: LignePersonne[]; faits: FaitsPersonne[] }> {
  const fin = Date.now() + (o.dureeMaxMs ?? DUREE_MAX_MS)
  const items: Item[] = lu.genre === 'population'
    ? await lire((tx) => itemsDeLaPopulation(tx, lu.population))
    : lu.personnes.map((p) => { const q = lireQui(p); return { entree: p, qui: 'erreur' in q ? null : q } })

  // 1. Chaque personne, par resoudrePersonne, en paquets.
  const resolus: Resolu[] = []
  let i = 0
  while (i < items.length && Date.now() < fin) {
    const paquet = items.slice(i, i + PAQUET)
    resolus.push(...await lire((tx) => resoudrePaquet(tx, paquet, o.fonds)))
    i += paquet.length
  }
  const nonTraites = items.length - resolus.length

  // 2. Ce qu'il faut pour ecrire les lignes : fiches, emails, archives probables.
  const membresDe = (g: Groupe | null) => (g ? g.noeuds.filter((n) => n.startsWith('membre:')).map((n) => n.slice(7)) : [])
  const tousMembres = uniques(resolus.flatMap((r) => membresDe(r.groupe)))
  const fiches = new Map<string, { prenom: string | null; nom: string | null; telegram: string | null }>()
  const emails = new Map<string, string[]>()
  const archivesProbables = uniques(resolus.flatMap((r) => (r.groupe ? probablesDuGroupe(r.groupe).archives : [])))
  const tgArchive = new Map<string, number[]>()
  if (tousMembres.length || archivesProbables.length) {
    await lire(async (tx) => {
      if (tousMembres.length) {
        const f = await tx.$queryRawUnsafe<{ id: string; prenom: string | null; nom: string | null; telegram: string | null }[]>(`
          select membre_id::text as id, prenom, nom, nullif(btrim(telegram), '') as telegram
          from public.cockpit_membres where membre_id = any($1::uuid[])`, tousMembres)
        for (const x of f) fiches.set(x.id, x)
        const e = await tx.$queryRawUnsafe<{ id: string; email: string }[]>(`
          select membre_id::text as id, lower(email) as email from public.cockpit_membre_emails where membre_id = any($1::uuid[])`, tousMembres)
        for (const x of e) emails.set(x.id, [...(emails.get(x.id) ?? []), x.email])
      }
      if (o.fonds && archivesProbables.length) {
        const a = await tx.$queryRawUnsafe<{ id: string; tg: string[] | null }[]>(`
          select personne_id as id, tg_ids as tg from public.cockpit_arch_personnes where personne_id = any($1::text[])`, archivesProbables)
        for (const x of a) tgArchive.set(x.id, (x.tg ?? []).filter((t) => /^u\d{5,15}$/.test(t)).map((t) => Number(t.slice(1))))
      }
    })
  }

  // 3. Une fiche sans compte : relue par ses emails (resoudrePersonne sur chacun).
  const faits: FaitsPersonne[] = resolus.map((r) => {
    const m = membresDe(r.groupe)
    const fiche = m.map((id) => fiches.get(id)).find((x) => x && (x.prenom || x.nom))
    const nomFiche = fiche ? [fiche.prenom, fiche.nom].filter(Boolean).join(' ').trim() || null : null
    if (!r.groupe) return { entree: r.item.entree, statut: r.statut, fiche: null, durs: [], probables: [], pseudoDeclare: null, candidats: [], nbPersonnes: r.nbPersonnes }
    const c = comptesDuGroupe(r.groupe)
    const p = probablesDuGroupe(r.groupe)
    const probables = [...p.comptes, ...p.archives.flatMap((a) => (tgArchive.get(a) ?? []).map((id) => ({ id, voie: 'pont_archive' as const })))]
    return {
      entree: r.item.entree, statut: 'un' as const, fiche: nomFiche,
      durs: c.durs, probables, pseudoDeclare: m.map((id) => fiches.get(id)?.telegram).find((x) => !!x) ?? null,
      candidats: uniques([...c.parNom, ...r.candidatsTg]),
    }
  })
  const aRelire = faits.map((f, k) => ({ f, k })).filter(({ f, k }) => f.statut === 'un' && !f.durs.length && membresDe(resolus[k].groupe).length)
  for (let j = 0; j < aRelire.length && Date.now() < fin; j += PAQUET) {
    const paquet = aRelire.slice(j, j + PAQUET)
    await lire(async (tx) => {
      for (const { f, k } of paquet) {
        const siens = new Set(membresDe(resolus[k].groupe).map((id) => `membre:${id}`))
        for (const email of uniques(membresDe(resolus[k].groupe).flatMap((id) => emails.get(id) ?? []))) {
          const r = await resoudrePersonne(tx, { genre: 'email', email }, { candidats: false, fonds: o.fonds })
          const groupes = r.statut === 'un' ? [r.groupe] : r.statut === 'plusieurs' ? r.groupes : []
          for (const g of groupes) {
            const c = comptesDuGroupe(g)
            // Un groupe qui porte la fiche, ou un compte identifie EXACTEMENT par cet email.
            if (g.noeuds.some((n) => siens.has(n))) f.durs.push(...c.durs)
            else f.durs.push(...c.durs.filter((d) => g.touches.some((t) => t.noeud === `tg:${d.id}`)))
          }
        }
      }
    })
  }

  // 4. Toujours rien : les candidats par le nom (noms affiches du registre et des noms passes).
  const sansRien = faits.filter((f) => f.statut === 'un' && !f.durs.length && !f.probables.length && !f.pseudoDeclare && f.fiche)
  if (sansRien.length) {
    const noms = await lire((tx) => tx.$queryRawUnsafe<{ id: string; nom: string | null }[]>(`
      select telegram_id::text as id, nom_affiche as nom from public.cockpit_telegram_membres where nom_affiche is not null
      union
      select telegram_id::text, nom_affiche from public.cockpit_telegram_noms where nom_affiche is not null`))
    const index: NomAffiche[] = indexerNoms(noms.map((x) => ({ id: Number(x.id), nom: x.nom })))
    // L'archive (nom, alias) d'une personne qui porte un compte : seulement si ce compte voit le fonds.
    const archives = o.fonds
      ? await lire((tx) => tx.$queryRawUnsafe<{ nom: string | null; alias: string | null; tg: string[] }[]>(`
          select nom, alias, tg_ids as tg from public.cockpit_arch_personnes where cardinality(tg_ids) > 0`))
      : []
    const tgDeLArchive = archives.map((a) => a.tg.filter((t) => /^u\d{5,15}$/.test(t)).map((t) => Number(t.slice(1))))
    const indexArchive = indexerNoms(archives.map((a, k) => ({ id: k, nom: `${a.nom ?? ''} ${a.alias ?? ''}` })))
    for (const f of sansRien) {
      const k = faits.indexOf(f)
      const fiche = membresDe(resolus[k].groupe).map((id) => fiches.get(id)).find((x) => x && x.prenom && x.nom)
      if (!fiche) continue
      const parArchive = candidatsParNom(fiche.prenom, fiche.nom, indexArchive).flatMap((a) => tgDeLArchive[a] ?? [])
      f.candidats = uniques([...f.candidats, ...candidatsParNom(fiche.prenom, fiche.nom, index), ...parArchive])
    }
  }

  // 5. Les comptes a nommer, puis les lignes.
  const ids = uniques(faits.flatMap((f) => [...f.durs.map((x) => x.id), ...f.probables.map((x) => x.id), ...f.candidats]))
  const comptes = new Map<number, CompteLu>()
  if (ids.length) {
    const l = await lire((tx) => tx.$queryRawUnsafe<{ id: string; gp: string | null; gn: string | null; present: boolean | null; registre: boolean; np: string | null; nn: string | null }[]>(`
      select t.id::text as id, g.pseudo as gp, g.nom_affiche as gn, g.present, g.telegram_id is not null as registre,
        (select n.pseudo from public.cockpit_telegram_noms n where n.telegram_id = t.id and nullif(n.pseudo, '') is not null order by n.dernier_vu desc limit 1) as np,
        (select n.nom_affiche from public.cockpit_telegram_noms n where n.telegram_id = t.id and nullif(n.nom_affiche, '') is not null order by n.dernier_vu desc limit 1) as nn
      from unnest($1::bigint[]) as t(id)
      left join public.cockpit_telegram_membres g on g.telegram_id = t.id`, ids))
    for (const x of l) {
      comptes.set(Number(x.id), { id: Number(x.id), pseudo: x.gp || x.np || null, nom: x.gn || x.nn || null, present: x.present === true, registre: x.registre })
    }
  }
  const resultats = faits.map((f) => lignePersonne(f, comptes))
  const quoi = lu.genre === 'population' ? POPULATIONS[lu.population] : `liste de ${lu.personnes.length} entrées`
  const { texte, lignesRendues } = reponseListe(resultats, { quoi, nonTraites, doublons: lu.genre === 'liste' ? lu.doublons : 0 })
  return { texte, lignes: lignesRendues, resultats, faits }
}
