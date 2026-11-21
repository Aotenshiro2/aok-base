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
// sous une limite de temps. (21/11, relecture) Chaque paquet est essaye a
// part : un paquet en erreur (requete trop lente, transaction expiree) ou
// hors du temps laisse ses personnes « non terminé », les autres sont
// rendues ; chaque etape teste le temps ; rien n'est dit complet si une
// personne n'est pas terminee.

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { lireQui, type Groupe, type QuiLu } from '@/lib/fiche-personne-pur'
import { resoudrePersonne } from '@/lib/fiche-personne'
import {
  MAX_ENTREE, NOTE_POPULATION, PLAFOND_POPULATION, POPULATIONS, candidatsParNom, comptesDuGroupe, indexerNoms, lignePersonne,
  lireEntreeListe, probablesDuGroupe, reponseListe, type CompteLu, type EntreeListe, type FaitsPersonne, type LignePersonne,
  type NomAffiche, type Voie,
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

const raisonCourte = (err: unknown) => (err instanceof Error ? err.message.split('\n').filter(Boolean).pop() ?? '' : String(err)).slice(0, 160)

/**
 * Une etape (un paquet, une lecture) : sautee si le temps est passe, son
 * erreur gardee au journal. null = pas faite : l'appelant marque ses
 * personnes non terminees. Jamais par personne : apres une erreur, la
 * transaction du paquet est morte.
 */
async function essayer<T>(fin: number, quoi: string, f: (tx: Tx) => Promise<T>): Promise<T | null> {
  if (Date.now() >= fin) return null
  try {
    return await lire(f)
  } catch (err) {
    console.error(`[cockpit/liste] ${quoi} : ${raisonCourte(err)}`)
    return null
  }
}

/** Une personne a resoudre : ce qu'on a donne, ou une fiche de la population (avec son nom, pour une relance). */
type Item = { entree: string | null; qui: QuiLu | null; nom?: string | null }

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

type Resolu = {
  item: Item; statut: FaitsPersonne['statut']; groupe: Groupe | null; nbPersonnes?: number
  candidatsTg: number[]; probablesTg: { id: number; voie: Voie }[]; indices: string[]; parFragment: boolean
}

/** Les indices de resoudrePersonne, courts (« accès broker sans compte Telegram relié »). */
function indicesCourts(l: string[]): string[] {
  return l.map((x) => x.replace(/^Cet email a un /, '').replace(/\s*:\s*voir .*$/, '').replace(/ pour l'instant/, '').replace(/\.$/, ''))
}
function indicesDeLaReponse(reponse: string): string[] {
  try {
    const v = JSON.parse(reponse) as { indices?: unknown }
    return Array.isArray(v.indices) ? indicesCourts(v.indices.filter((x): x is string => typeof x === 'string')) : []
  } catch { return [] }
}

/** Une entree par NOM qui n'a touche la fiche que par fragment (pas d'egalite). */
function parFragment(qui: QuiLu, g: Groupe): boolean {
  if (qui.genre !== 'texte') return false
  const surFiche = g.touches.filter((t) => t.noeud.startsWith('membre:'))
  return surFiche.length > 0 && !surFiche.some((t) => t.exact)
}

/** Resout les items d'un paquet, chacun par resoudrePersonne. */
async function resoudrePaquet(tx: Tx, items: Item[], fonds: boolean): Promise<Resolu[]> {
  const r: Resolu[] = []
  const vide = { groupe: null, candidatsTg: [], probablesTg: [], indices: [], parFragment: false }
  for (const item of items) {
    if (!item.qui) { r.push({ item, statut: 'illisible', ...vide }); continue }
    const res = await resoudrePersonne(tx, item.qui, { candidats: false, fonds })
    if (res.statut === 'aucun') { r.push({ item, statut: 'aucun', ...vide, indices: indicesDeLaReponse(res.reponse) }); continue }
    if (res.statut === 'un') {
      r.push({ item, statut: 'un', ...vide, groupe: res.groupe, indices: indicesCourts(res.indices), parFragment: parFragment(item.qui, res.groupe) })
      continue
    }
    const { personne, autres } = choisir(res.groupes)
    const comptes = autres.map((g) => comptesDuGroupe(g))
    const candidatsTg = comptes.flatMap((c) => [...c.durs.map((x) => x.id), ...c.parNom])
    const probablesTg = comptes.flatMap((c) => c.probables)
    if (personne) r.push({ item, statut: 'un', ...vide, groupe: personne, candidatsTg, probablesTg, parFragment: parFragment(item.qui, personne) })
    else r.push({ item, statut: 'plusieurs', ...vide, nbPersonnes: res.groupes.length })
  }
  return r
}

/** La population nommee : ses fiches, en items, avec leur nom (pour une relance). */
async function itemsDeLaPopulation(tx: Tx, population: keyof typeof POPULATIONS): Promise<Item[]> {
  const vivant = population === 'membres_live_club'
  const l = await tx.$queryRawUnsafe<{ id: string; prenom: string | null; nom: string | null }[]>(`
    select m.membre_id::text as id, min(m.prenom) as prenom, min(m.nom) as nom
    from public.cockpit_membres m
    join public.cockpit_abonnements a on a.membre_id = m.membre_id and a.offre_id = 'live-club'
    group by m.membre_id
    having bool_or(a.statut in ${VIVANT}) = $1
    order by 1`, vivant)
  return l.map((x) => ({
    entree: null, qui: { genre: 'membre', id: x.id },
    nom: [x.prenom, x.nom].filter(Boolean).join(' ').trim() || null,
  }))
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
    const raison = raisonCourte(err)
    console.error(`[cockpit/liste] rapprochement impossible : ${raison}`)
    return { texte: JSON.stringify({ statut: 'erreur', erreur: `Rapprochement impossible (${raison}) : réessaie dans un instant, ou découpe la liste.` }), lignes: 0 }
  }
}

export async function rapprocher(lu: EntreeListe, o: { fonds: boolean; dureeMaxMs?: number }): Promise<{ texte: string; lignes: number; resultats: LignePersonne[]; faits: FaitsPersonne[] }> {
  const fin = Date.now() + (o.dureeMaxMs ?? DUREE_MAX_MS)

  // 0. Les personnes : la liste donnee, ou une page de la population.
  let items: Item[]
  let page: { page: number; pages: number; total: number; parPage: number } | undefined
  if (lu.genre === 'population') {
    const tous = await lire((tx) => itemsDeLaPopulation(tx, lu.population))
    const pages = Math.max(1, Math.ceil(tous.length / PLAFOND_POPULATION))
    const p = Math.min(Math.max(1, Math.floor(lu.page) || 1), pages)
    items = tous.slice((p - 1) * PLAFOND_POPULATION, p * PLAFOND_POPULATION)
    page = { page: p, pages, total: tous.length, parPage: PLAFOND_POPULATION }
  } else {
    items = lu.personnes.map((p) => {
      if (p.length > MAX_ENTREE) return { entree: p, qui: null }
      const q = lireQui(p)
      return { entree: p, qui: 'erreur' in q ? null : q }
    })
  }

  // 1. Chaque personne, par resoudrePersonne, en paquets essayes chacun a part.
  const resolus: Resolu[] = []
  for (let i = 0; i < items.length; i += PAQUET) {
    const paquet = items.slice(i, i + PAQUET)
    const r = await essayer(fin, `paquet ${i / PAQUET + 1}`, (tx) => resoudrePaquet(tx, paquet, o.fonds))
    resolus.push(...(r ?? paquet.map((item): Resolu => ({
      item, statut: 'non_termine', groupe: null, candidatsTg: [], probablesTg: [], indices: [], parFragment: false,
    }))))
  }

  // 2. Ce qu'il faut pour ecrire les lignes : fiches, emails, archives probables.
  const membresDe = (g: Groupe | null) => (g ? g.noeuds.filter((n) => n.startsWith('membre:')).map((n) => n.slice(7)) : [])
  const tousMembres = uniques(resolus.flatMap((r) => membresDe(r.groupe)))
  const fiches = new Map<string, { prenom: string | null; nom: string | null; telegram: string | null }>()
  const emails = new Map<string, string[]>()
  const archivesProbables = uniques(resolus.flatMap((r) => (r.groupe ? probablesDuGroupe(r.groupe).archives : [])))
  const tgArchive = new Map<string, number[]>()
  let fichesLues = true
  if (tousMembres.length || archivesProbables.length) {
    const ok = await essayer(fin, 'fiches et emails', async (tx) => {
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
      return true
    })
    fichesLues = ok === true
  }

  const faits: FaitsPersonne[] = resolus.map((r) => {
    const m = membresDe(r.groupe)
    const fiche = m.map((id) => fiches.get(id)).find((x) => x && (x.prenom || x.nom))
    const nomFiche = fiche ? [fiche.prenom, fiche.nom].filter(Boolean).join(' ').trim() || null : (r.item.nom ?? null)
    const commun = { entree: r.item.entree, fiche: nomFiche, ...(r.indices.length ? { indices: r.indices } : {}) }
    if (!r.groupe) return { ...commun, statut: r.statut, durs: [], probables: [], pseudoDeclare: null, candidats: [], nbPersonnes: r.nbPersonnes }
    const c = comptesDuGroupe(r.groupe)
    const p = probablesDuGroupe(r.groupe)
    const probables = [
      ...c.probables, ...p.comptes, ...r.probablesTg,
      ...p.archives.flatMap((a) => (tgArchive.get(a) ?? []).map((id) => ({ id, voie: 'pont_archive' as const }))),
    ]
    return {
      ...commun, statut: 'un' as const,
      durs: c.durs, probables, pseudoDeclare: m.map((id) => fiches.get(id)?.telegram).find((x) => !!x) ?? null,
      candidats: uniques([...c.parNom, ...r.candidatsTg]),
      ...(r.parFragment ? { parFragment: true } : {}),
      // Fiches non lues : ni relecture par email ni candidats par le nom possibles.
      ...(!fichesLues && !c.durs.length && m.length ? { inacheve: true } : {}),
    }
  })

  // 3. Une fiche sans compte : relue par ses emails (resoudrePersonne sur chacun), par paquets.
  const aRelire = fichesLues
    ? faits.map((f, k) => ({ f, k })).filter(({ f, k }) => f.statut === 'un' && !f.durs.length && membresDe(resolus[k].groupe).length)
    : []
  for (let j = 0; j < aRelire.length; j += PAQUET) {
    const paquet = aRelire.slice(j, j + PAQUET)
    const ajouts = await essayer(fin, `relecture par email ${j / PAQUET + 1}`, async (tx) => {
      // Rien n'est ecrit dans les faits avant la fin du paquet : un paquet en erreur ne laisse rien a moitie.
      const a: { k: number; durs: { id: number; voie: Voie }[]; probables: { id: number; voie: Voie }[] }[] = []
      for (const { k } of paquet) {
        const siens = new Set(membresDe(resolus[k].groupe).map((id) => `membre:${id}`))
        const x = { k, durs: [] as { id: number; voie: Voie }[], probables: [] as { id: number; voie: Voie }[] }
        for (const email of uniques(membresDe(resolus[k].groupe).flatMap((id) => emails.get(id) ?? []))) {
          const r = await resoudrePersonne(tx, { genre: 'email', email }, { candidats: false, fonds: o.fonds })
          const groupes = r.statut === 'un' ? [r.groupe] : r.statut === 'plusieurs' ? r.groupes : []
          for (const g of groupes) {
            const c = comptesDuGroupe(g)
            // Un groupe qui porte la fiche, ou un compte identifie EXACTEMENT par cet email.
            if (g.noeuds.some((n) => siens.has(n))) x.durs.push(...c.durs)
            else x.durs.push(...c.durs.filter((d) => g.touches.some((t) => t.noeud === `tg:${d.id}`)))
            x.probables.push(...c.probables)
          }
        }
        a.push(x)
      }
      return a
    })
    if (!ajouts) { for (const { f } of paquet) f.inacheve = true; continue }
    for (const x of ajouts) { faits[x.k].durs.push(...x.durs); faits[x.k].probables.push(...x.probables) }
  }

  // 4. Toujours rien : les candidats par le nom (noms affiches du registre et des noms passes).
  const sansRien = faits.filter((f) => f.statut === 'un' && !f.inacheve && !f.durs.length && !f.probables.length && !f.pseudoDeclare && f.fiche)
  if (sansRien.length) {
    const lus = await essayer(fin, 'noms affiches', async (tx) => {
      const noms = await tx.$queryRawUnsafe<{ id: string; nom: string | null }[]>(`
        select telegram_id::text as id, nom_affiche as nom from public.cockpit_telegram_membres where nom_affiche is not null
        union
        select telegram_id::text, nom_affiche from public.cockpit_telegram_noms where nom_affiche is not null`)
      // L'archive (nom, alias) d'une personne qui porte un compte : seulement si ce compte voit le fonds.
      const archives = o.fonds
        ? await tx.$queryRawUnsafe<{ nom: string | null; alias: string | null; tg: string[] }[]>(`
            select nom, alias, tg_ids as tg from public.cockpit_arch_personnes where cardinality(tg_ids) > 0`)
        : []
      return { noms, archives }
    })
    if (!lus) for (const f of sansRien) f.inacheve = true
    else {
      const index: NomAffiche[] = indexerNoms(lus.noms.map((x) => ({ id: Number(x.id), nom: x.nom })))
      const tgDeLArchive = lus.archives.map((a) => a.tg.filter((t) => /^u\d{5,15}$/.test(t)).map((t) => Number(t.slice(1))))
      const indexArchive = indexerNoms(lus.archives.map((a, k) => ({ id: k, nom: `${a.nom ?? ''} ${a.alias ?? ''}` })))
      for (const f of sansRien) {
        const k = faits.indexOf(f)
        const fiche = membresDe(resolus[k].groupe).map((id) => fiches.get(id)).find((x) => x && x.prenom && x.nom)
        if (!fiche) continue
        const parArchive = candidatsParNom(fiche.prenom, fiche.nom, indexArchive).flatMap((a) => tgDeLArchive[a] ?? [])
        f.candidats = uniques([...f.candidats, ...candidatsParNom(fiche.prenom, fiche.nom, index), ...parArchive])
      }
    }
  }
  for (const f of faits) { f.durs = dedoublonner(f.durs); f.probables = dedoublonner(f.probables).filter((p) => !f.durs.some((d) => d.id === p.id)) }

  // 5. Les comptes a nommer, puis les lignes. Sans cette lecture (temps, erreur), les comptes restent « nom inconnu ».
  const ids = uniques(faits.flatMap((f) => [...f.durs.map((x) => x.id), ...f.probables.map((x) => x.id), ...f.candidats]))
  const comptes = new Map<number, CompteLu>()
  if (ids.length) {
    const l = await essayer(fin, 'noms des comptes', (tx) => tx.$queryRawUnsafe<{ id: string; gp: string | null; gn: string | null; present: boolean | null; registre: boolean; np: string | null; nn: string | null }[]>(`
      select t.id::text as id, g.pseudo as gp, g.nom_affiche as gn, g.present, g.telegram_id is not null as registre,
        (select n.pseudo from public.cockpit_telegram_noms n where n.telegram_id = t.id and nullif(n.pseudo, '') is not null order by n.dernier_vu desc limit 1) as np,
        (select n.nom_affiche from public.cockpit_telegram_noms n where n.telegram_id = t.id and nullif(n.nom_affiche, '') is not null order by n.dernier_vu desc limit 1) as nn
      from unnest($1::bigint[]) as t(id)
      left join public.cockpit_telegram_membres g on g.telegram_id = t.id`, ids))
    for (const x of l ?? []) {
      comptes.set(Number(x.id), { id: Number(x.id), pseudo: x.gp || x.np || null, nom: x.gn || x.nn || null, present: x.present === true, registre: x.registre })
    }
  }
  const resultats = faits.map((f) => lignePersonne(f, comptes))
  const quoi = lu.genre === 'population' ? POPULATIONS[lu.population] : `liste de ${lu.personnes.length} entrées`
  const { texte, lignesRendues } = reponseListe(resultats, {
    quoi, doublons: lu.genre === 'liste' ? lu.doublons : 0, page,
    ...(lu.genre === 'population' ? { notePopulation: NOTE_POPULATION } : {}),
  })
  return { texte, lignes: lignesRendues, resultats, faits }
}

/** Un compte une seule fois, sa premiere voie gardee. */
function dedoublonner(l: { id: number; voie: Voie }[]): { id: number; voie: Voie }[] {
  const vus = new Set<number>()
  return l.filter((x) => (vus.has(x.id) ? false : (vus.add(x.id), true)))
}
