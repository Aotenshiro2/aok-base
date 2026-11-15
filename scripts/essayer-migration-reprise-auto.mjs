/**
 * ESSAI de la migration 20261115200000_academie_reprise_auto.sql (le
 * rattachement automatique et le pre-remplissage de l'avancee de Skool,
 * 15/11/2026 soir) et des requetes EXACTES de src/lib/academie/reprise-pur.ts,
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (lock_timeout
 * 5 s, rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : mode nom et sa source, mode
 *      auto, par facultatif en mode auto seulement, l'index du « une fois » sur
 *      membre ET auto ;
 *   2. les vraies donnees : la decision pour toute la base, et la meme decision
 *      compte par compte (la requete de /moi) ;
 *   3. des cas fabriques, chacun dans son point de sauvegarde, sur des membres
 *      de Skool FICTIFS poses sur de vrais comptes (leurs emails et leurs noms
 *      ne sortent jamais de la base : copies en SQL) :
 *      par email + pre-remplissage complet (cours fini, partiel, douteux, une
 *      lecon deja vue et une deja ouverte jamais touchees, aucun point, second
 *      passage sans effet, le bouton du journal d'avant refuse par l'index) ;
 *      par nom ; deux membres du meme nom ; deux comptes du meme nom (le profil
 *      de l'un, une fiche du cockpit de l'autre) ; membre deja rattache ;
 *      personne effacee ; nom vide ; le filet a la main (rattachement confirme par Brice) ;
 *   4. les contraintes (une source qui ne va pas avec son mode, un auto avec
 *      auteur, un geste de l'equipe sans auteur) ;
 *   5. l'apercu de l'effacement (STABLE, rien n'est touche) d'un compte
 *      rattache par email puis par nom.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste. Aucun email, nom ni identifiant n'est affiche : des nombres.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env --env-file=.env.local scripts/essayer-migration-reprise-auto.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/reprise-pur.ts'
import * as Q from '../src/lib/academie/requetes.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261115200000_academie_reprise_auto.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find(u => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)

// Le meme decoupage que appliquer-migration.mjs (les blocs $...$ restent entiers).
function decouper(sql) {
  const ordres = []
  let courant = ''
  let tag = null
  let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]
    i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ordres = decouper(readFileSync(fichier, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))
if (ordres.some(o => /^(begin|commit|rollback|end)\b/i.test(o))) throw new Error('la migration contient begin/commit : refuse (l essai la validerait)')

class Annulation extends Error {}
const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const motif = e => String(e?.message ?? e).split('\n').find(l => /violates|check constraint|not-null|duplicate|unique|permission/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const big = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'bigint' ? Number(x) : x))

const etat = async c => big((await c.$queryRawUnsafe(`select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'academie_skool_membres'
     and column_name = 'rattache_source')::int as colonne_source,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'academie_reprises'
     and column_name = 'par') as par_nullable,
  (select string_agg(conname || '=' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint
    where conrelid in ('public.academie_skool_membres'::regclass, 'public.academie_reprises'::regclass)) as contraintes,
  (select indexdef from pg_indexes where indexname = 'academie_reprises_une_fois_idx') as index_une_fois,
  (select md5(coalesce(string_agg(skool_member_id || ':' || coalesce(profile_id::text, '-') || ':' || coalesce(rattache_mode, '-'), ',' order by skool_member_id), ''))
     from public.academie_skool_membres) as rattachements,
  (select count(*) from public.academie_skool_membres)::int as membres,
  (select count(*) from public.academie_progression_skool)::int as releve,
  (select count(*) from public.academie_reprises)::int as reprises,
  (select count(*) from public.academie_progression)::int as progression,
  (select count(*) from public.cockpit_membres)::int as fiches,
  (select count(*) from public.cockpit_membre_emails)::int as fiche_emails,
  (select count(*) from public.cockpit_oublis_emails)::int as oublis`))[0])

async function point(tx, nom, fn) {
  await tx.$executeRawUnsafe(`savepoint ${nom}`)
  try {
    return await fn()
  } finally {
    await tx.$executeRawUnsafe(`rollback to savepoint ${nom}`)
  }
}
async function refuse(tx, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint refus_essai')
  try {
    await tx.$executeRawUnsafe(sql, ...params)
    return null
  } catch (e) {
    return motif(e)
  } finally {
    await tx.$executeRawUnsafe('rollback to savepoint refus_essai')
  }
}

// Des membres de Skool FICTIFS (ids hexadecimaux reconnaissables), poses en SQL a partir d'un vrai compte.
const F = n => `e55a${'0'.repeat(26)}${String(n).padStart(2, '0')}`
const SQL_FICTIF_EMAIL = `insert into public.academie_skool_membres (skool_member_id, prenom, nom, email, email_source, releve_le)
  select $1, 'Essai', 'Fictif', lower(btrim(u.email)), 'export-07-11', '2026-11-15' from auth.users u where u.id = $2::uuid`
const SQL_FICTIF_NOM = `insert into public.academie_skool_membres (skool_member_id, prenom, nom, email, email_source, releve_le)
  select $1, upper(p.first_name), '  ' || p.last_name || ' ', null, 'aucune', '2026-11-15' from public.profiles p where p.id = $2::uuid`
const SQL_FICTIF_LIBRE = `insert into public.academie_skool_membres (skool_member_id, prenom, nom, email, email_source, releve_le)
  values ($1, $2, $3, null, 'aucune', '2026-11-15')`

const avant = await etat(prisma)
console.log(`avant : colonne rattache_source ${avant.colonne_source ? 'presente' : 'absente'}, par nullable ${avant.par_nullable}, `
  + `${avant.membres} membres de Skool, ${avant.reprises} reprises`)
const debut = Date.now()

try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const apres = await etat(tx)
    assert.equal(apres.colonne_source, 1)
    assert.equal(apres.par_nullable, 'YES')
    assert.match(apres.index_une_fois, /WHERE \(mode = ANY \(ARRAY\['membre'::text, 'auto'::text\]\)\)/)
    assert.match(apres.contraintes, /academie_reprises_mode_check=CHECK \(\(mode = ANY \(ARRAY\['membre'::text, 'equipe'::text, 'auto'::text\]\)\)\)/)
    assert.match(apres.contraintes, /academie_skool_membres_rattache_mode_check=CHECK .*'nom'::text/)
    assert.equal(apres.rattachements, avant.rattachements, 'aucun rattachement existant touche')
    ok(`migration jouee deux fois (${ordres.length} ordres) : mode nom et source, mode auto, par facultatif, index du une fois sur membre et auto, rattachements existants intacts`)

    // 2. Les vraies donnees : toute la base, puis compte par compte (la requete de /moi), la meme decision.
    const paires = R.lirePaires(big(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT)))
    const decision = R.deciderRattachements(paires)
    for (const r of decision.rattachements) {
      const d = R.deciderRattachements(R.lirePaires(big(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT_COMPTE, r.compte))))
      assert.deepEqual(d.rattachements.find(x => x.compte === r.compte), r)
    }
    for (const x of decision.refus) {
      const d = R.deciderRattachements(R.lirePaires(big(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT_COMPTE, x.compte))))
      assert.equal(d.rattachements.find(y => y.compte === x.compte), undefined)
    }
    const avecPaire = new Set(paires.map(p => p.compte))
    const comptes = big(await tx.$queryRawUnsafe(`select p.id::text as id,
        (nullif(btrim(p.first_name), '') is not null and nullif(btrim(p.last_name), '') is not null) as nom_complet,
        (u.email is not null and u.email_confirmed_at is not null) as email_confirme,
        exists (select 1 from public.cockpit_membre_emails f where lower(btrim(f.email)) = lower(btrim(u.email))) as dans_une_fiche,
        exists (select 1 from public.academie_skool_membres m where m.profile_id = p.id) as relie,
        exists (select 1 from public.academie_reprises r where r.user_id = p.id) as reprises,
        exists (select 1 from public.academie_progression g where g.user_id = p.id) as progression,
        exists (select 1 from public.academie_skool_membres m where m.email = lower(btrim(u.email))) as email_skool
      from public.profiles p join auth.users u on u.id = p.id order by p.id`))
    const libres = comptes.filter(c => !avecPaire.has(c.id) && !c.relie && !c.reprises)
    let vides = 0
    for (const c of libres.slice(0, 5)) {
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT_COMPTE, c.id)).length, 0)
      vides++
    }
    // A : sans progression et sans membre de Skool a son adresse (meme ambigu), pour compter juste.
    ok(`vraies donnees : ${decision.rattachements.length} rattachements (email ${decision.rattachements.filter(r => r.mode === 'email').length}, `
      + `nom ${decision.rattachements.filter(r => r.mode === 'nom').length}), ${decision.refus.length} refus, la meme decision compte par compte `
      + `(${decision.rattachements.length + decision.refus.length} comptes relus), ${vides} comptes sans rien : requete de /moi vide`)

    const A = libres.find(c => c.email_confirme && !c.progression && !c.email_skool)
    const B = libres.find(c => c.nom_complet && c.id !== A.id)
    const E = libres.find(c => c.email_confirme && !c.dans_une_fiche && c.id !== A.id && c.id !== B.id)
    const X = comptes.find(c => !c.relie && c.id !== A.id && c.id !== B.id && c.id !== E.id)
    assert.ok(A && B && E && X, 'comptes d essai trouves')
    const pairesDe = async c => R.lirePaires(big(await tx.$queryRawUnsafe(R.SQL_PAIRES_RATTACHEMENT_COMPTE, c)))
    const deciderPour = async c => {
      const d = R.deciderRattachements(await pairesDe(c))
      return { lien: d.rattachements.find(x => x.compte === c) ?? null, refus: d.refus.filter(x => x.compte === c).map(x => x.motif), d }
    }

    // 3a. Par email, puis le pre-remplissage complet.
    await point(tx, 'cas_email', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_EMAIL, F(1), A.id)
      const { lien } = await deciderPour(A.id)
      assert.deepEqual(lien, { compte: A.id, membre: F(1), mode: 'email', source: 'connexion' })
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, A.id, F(1), 'email', 'connexion')).length, 1)
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, A.id, F(1), 'email', 'connexion')).length, 0, 'une seule fois')
      const [m] = big(await tx.$queryRawUnsafe(`select rattache_mode, rattache_source, rattache_par is null as sans_auteur
        from public.academie_skool_membres where skool_member_id = $1`, F(1)))
      assert.deepEqual(m, { rattache_mode: 'email', rattache_source: 'connexion', sans_auteur: true })
      // Un compte deja rattache ne l'est jamais une deuxieme fois.
      await tx.$executeRawUnsafe(SQL_FICTIF_LIBRE, F(2), 'Autre', 'Fictif')
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, A.id, F(2), 'nom', 'profil')).length, 0)
      // 4. Les contraintes.
      assert.ok(await refuse(tx, `update public.academie_skool_membres set rattache_source = 'profil' where skool_member_id = $1`, F(1)), 'email/profil')
      assert.ok(await refuse(tx, `update public.academie_skool_membres set rattache_mode = 'nom' where skool_member_id = $1`, F(1)), 'nom/connexion')
      assert.ok(await refuse(tx, `update public.academie_skool_membres set rattache_mode = 'equipe', rattache_source = null where skool_member_id = $1`, F(1)),
        'a la main sans auteur')
      ok('par email : rattache (email, connexion, sans auteur), une seule fois, jamais un second membre sur ce compte, contraintes de la source tenues')

      // Le releve fictif : Novice fini, Partie 1 a 10 sur 42, Partie 2 a 0, Chronique (douteux), Replay Premium a 5 sur 22.
      const titre = id => R.CORRESPONDANCE_SKOOL.find(c => c.skool === id).titre
      const cours = [
        ['a8ce77d4d50147bd9e97badd28baebec', 7, 7], ['37e96d438ae74ba89cfed1802431abbb', 10, 42], ['db9ea221835b43bc96e52e162cfa3559', 0, 42],
        ['0ef8880bf45f40e59ba84f90b6729920', 30, 66], ['d7be803d71994500b765073a16acbdaf', 5, 22],
      ]
      await tx.$queryRawUnsafe(R.SQL_IMPORTER_COURS, cours.map(() => F(1)), cours.map(c => c[0]), cours.map(c => titre(c[0])),
        cours.map(c => c[1]), cours.map(c => c[2]), cours.map(c => Math.round((c[1] * 100) / c[2])), cours.map(() => true), '2026-11-15')
      const cat = {
        modules: big(await tx.$queryRawUnsafe(Q.SQL_MODULES_VISIBLES)).map(x => ({ id: x.id, slug: x.slug, statut: x.statut, lienExterne: x.lien_externe ?? null })),
        sections: big(await tx.$queryRawUnsafe(Q.SQL_SECTIONS_VISIBLES)).map(x => ({ id: x.id, moduleId: x.module_id, ordre: Number(x.ordre), titre: x.titre })),
        lecons: big(await tx.$queryRawUnsafe(Q.SQL_LECONS_VISIBLES)).map(x => ({ id: x.id, moduleId: x.module_id, sectionId: x.section_id, ordre: Number(x.ordre), titre: x.titre, statut: x.statut })),
      }
      const mod = slug => cat.modules.find(x => x.slug === slug)
      const novice = mod('novice-en-trading')
      const formation = mod('la-formation-complete')
      const rediff = mod('rediffusion-des-lives')
      const chroniques = mod('chroniques-de-l-accelerateur')
      const p1 = cat.sections.find(s => s.moduleId === formation.id && R.normaliserTitre(s.titre).startsWith('partie 1'))
      const rp = cat.sections.find(s => s.moduleId === rediff.id && R.normaliserTitre(s.titre).startsWith('replay premium'))
      const leconsNovice = R.leconsDansLOrdre(cat, novice.id)
      const leconsP1 = R.leconsDansLOrdre(cat, formation.id, p1.id)
      const leconsRp = R.leconsDansLOrdre(cat, rediff.id, rp.id)
      const kP1 = R.nombreACocher(10, 42, leconsP1.length)
      const kRp = R.nombreACocher(5, 22, leconsRp.length)
      // Deja la : la 1re lecon de Novice vue par la mesure, la 1re de la Partie 1 ouverte (pas vue).
      await tx.$executeRawUnsafe(`insert into public.academie_progression (user_id, lecon_id, secondes_vues, terminee_le, vu_le, vu_par, derniere_vue_le, nb_sessions)
        values ($1::uuid, $2::uuid, 900, now() - interval '2 days', now() - interval '2 days', 'mesure', now() - interval '2 days', 1),
               ($1::uuid, $3::uuid, 60, null, null, null, now() - interval '1 day', 1)`, A.id, leconsNovice[0], leconsP1[0])
      const activite = async () => big(await tx.$queryRawUnsafe(
        `select coalesce(sum(lecons), 0)::int as n from public.aok_activite_par_jour($1::uuid, 'Europe/Paris')`, A.id))[0].n
      const activiteAvant = await activite()

      const [e1] = big(await tx.$queryRawUnsafe(R.SQL_ETAT_AUTO, A.id))
      assert.equal(e1.relie, true)
      assert.equal(R.releveDeJson(e1.releve).length, 4, 'Chronique n est meme pas lue')
      const items = R.planRemplissage({ releve: R.releveDeJson(e1.releve), catalogue: cat, verrousFaits: e1.verrous })
      assert.deepEqual(items.map(i => [i.moduleId, i.portee, i.sectionId]).sort(), [
        [formation.id, 'section', p1.id], [novice.id, 'module', null], [rediff.id, 'section', rp.id],
      ].sort())
      const fait = await R.ecrireRemplissage(tx, A.id, items)
      assert.deepEqual(fait, { cours: 3, lecons: leconsNovice.length - 1 + kP1 - 1 + kRp })
      const lignes = big(await tx.$queryRawUnsafe(`select p.lecon_id::text as l, p.vu_par, p.vu_le is not null as vu, p.terminee_le is not null as preuve,
          p.marquee_vue_le is not null as clic, p.secondes_vues, p.nb_sessions, l.module_id::text as module
        from public.academie_progression p join public.academie_lecons l on l.id = p.lecon_id where p.user_id = $1::uuid`, A.id))
      const de = id => lignes.find(x => x.l === id)
      assert.deepEqual([de(leconsNovice[0]).vu_par, de(leconsNovice[0]).preuve], ['mesure', true], 'la lecon vue par la mesure intacte')
      assert.deepEqual([de(leconsP1[0]).vu, de(leconsP1[0]).nb_sessions, de(leconsP1[0]).secondes_vues], [false, 1, 60], 'la lecon ouverte intacte')
      for (const id of [...leconsNovice.slice(1), ...leconsP1.slice(1, kP1), ...leconsRp.slice(0, kRp)]) {
        const x = de(id)
        assert.ok(x, 'cochee')
        assert.deepEqual([x.vu_par, x.preuve, x.clic, x.secondes_vues, x.nb_sessions], ['reprise', false, false, 0, 0])
      }
      assert.equal(de(leconsP1[kP1]), undefined, 'pas au-dela de la part de Skool')
      assert.equal(lignes.filter(x => x.module === chroniques.id).length, 0, 'cours douteux exclu')
      assert.equal(await activite(), activiteAvant, 'aucun point')
      const journal = big(await tx.$queryRawUnsafe(`select mode, par is null as sans_auteur, verrou, cardinality(lecons)::int as n, deja_vues, pourcentage_skool
        from public.academie_reprises where user_id = $1::uuid order by verrou`, A.id))
      assert.equal(journal.length, 3)
      for (const j of journal) assert.deepEqual([j.mode, j.sans_auteur], ['auto', true])
      assert.deepEqual(journal.map(j => j.verrou).sort(), items.map(i => i.verrou).sort())
      assert.equal(journal.reduce((n, j) => n + j.deja_vues, 0), 2, 'les deux lecons deja la, laissees')
      ok(`pre-remplissage : 3 cours (Novice fini ${leconsNovice.length - 1} lecons, Partie 1 ${kP1 - 1} sur ${leconsP1.length} dans l ordre, `
        + `Replay Premium ${kRp}), Chronique exclue, la lecon vue et la lecon ouverte intactes, ni preuve ni clic ni temps, aucun point`)

      // Second passage : rien.
      const [e2] = big(await tx.$queryRawUnsafe(R.SQL_ETAT_AUTO, A.id))
      assert.deepEqual(R.planRemplissage({ releve: R.releveDeJson(e2.releve), catalogue: cat, verrousFaits: e2.verrous }), [])
      assert.deepEqual(await R.ecrireRemplissage(tx, A.id, items), { cours: 0, lecons: 0 })
      // Le bouton : le journal d'avant (on conflict ... where mode = 'membre') bute sur l'index des deux modes ;
      // un cours pas pre-rempli reste possible.
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_POSER_REPRISE, A.id, novice.id, null, 'module', `module:${novice.id}`, 0, null)).length, 0)
      const autre = mod('psychologie-et-emotions')
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_POSER_REPRISE, A.id, autre.id, null, 'module', `module:${autre.id}`, 0, null)).length, 1)
      const faites = big(await tx.$queryRawUnsafe(R.SQL_REPRISES_DU_COMPTE, A.id))
      assert.equal(faites.filter(f => f.mode === 'auto').length, 3)
      assert.equal(faites.find(f => f.module_id === novice.id).lecons, leconsNovice.length - 1)
      const [fA] = big(await tx.$queryRawUnsafe(R.SQL_FAITS_REPRISE, A.id))
      assert.equal(fA.releve_skool, true)
      // 5. L'apercu de l'effacement : les reprises auto et le membre de Skool rattache.
      const [ap] = big(await tx.$queryRawUnsafe(`select public.cockpit_effacement_apercu(3, '{}'::bigint[], '{}'::uuid[],
          coalesce((select array_agg(lower(u.email)) from auth.users u where u.id = $1::uuid and u.email is not null), '{}'::text[]),
          '{}'::text[]) as a`, A.id))
      assert.equal(ap.a.efface.academie_reprises, 4, '3 auto et 1 membre')
      assert.equal(ap.a.efface.academie_membres_skool, 1)
      assert.equal(ap.a.efface.academie_releve_skool, 5)
      ok('second passage sans effet ; le bouton du journal d avant refuse par l index (membre et auto), un autre cours possible ; '
        + '/moi rend les reprises auto ; l apercu de l effacement compte les reprises auto et le membre rattache')
    })

    // 3b. Par nom (casse, espaces), et l'apercu de l'effacement le retrouve par le rattachement.
    await point(tx, 'cas_nom', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_NOM, F(3), B.id)
      const { lien } = await deciderPour(B.id)
      assert.deepEqual(lien, { compte: B.id, membre: F(3), mode: 'nom', source: 'profil' })
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, B.id, F(3), 'nom', 'profil')).length, 1)
      const [ap] = big(await tx.$queryRawUnsafe(`select public.cockpit_effacement_apercu(3, '{}'::bigint[], '{}'::uuid[],
          coalesce((select array_agg(lower(u.email)) from auth.users u where u.id = $1::uuid and u.email is not null), '{}'::text[]),
          '{}'::text[]) as a`, B.id))
      assert.equal(ap.a.efface.academie_membres_skool, 1, 'retrouve par le rattachement (il n a pas d email)')
      ok('par nom (majuscules et espaces en trop) : rattache (nom, profil, sans auteur), retrouve par l effacement')
    })

    // 3c. Deux membres de Skool du meme nom.
    await point(tx, 'cas_homonymes', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_NOM, F(4), B.id)
      await tx.$executeRawUnsafe(SQL_FICTIF_NOM, F(5), B.id)
      const { lien, d } = await deciderPour(B.id)
      assert.equal(lien, null)
      assert.equal(d.nomsHomonymes, 1)
      ok('deux membres de Skool du meme nom : aucun rattachement')
    })

    // 3d. Deux comptes du meme nom : le profil de B, et une fiche du cockpit (fictive) de E qui porte le meme nom.
    await point(tx, 'cas_deux_comptes', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_NOM, F(6), B.id)
      const [fiche] = big(await tx.$queryRawUnsafe(`insert into public.cockpit_membres (prenom, nom)
        select p.first_name, p.last_name from public.profiles p where p.id = $1::uuid returning membre_id::text as id`, B.id))
      await tx.$executeRawUnsafe(`insert into public.cockpit_membre_emails (email, membre_id, principal, verifie)
        select lower(btrim(u.email)), $2::uuid, true, true from auth.users u where u.id = $1::uuid`, E.id, fiche.id)
      const pB = await deciderPour(B.id)
      const pE = await deciderPour(E.id)
      assert.equal(pB.lien, null)
      assert.equal(pE.lien, null)
      assert.deepEqual(pB.refus, ['ambigu_membre'])
      assert.deepEqual(pE.refus, ['ambigu_membre'])
      assert.ok((await pairesDe(E.id)).some(p => p.compte === E.id && p.mode === 'nom' && p.source === 'fiche'), 'le nom de la fiche du cockpit compte')
      ok('deux comptes du meme nom (le profil de l un, la fiche du cockpit de l autre) : aucun rattachement')
    })

    // 3e. Le membre est deja rattache a un autre compte.
    await point(tx, 'cas_deja', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_NOM, F(7), B.id)
      await tx.$executeRawUnsafe(`update public.academie_skool_membres set profile_id = $2::uuid, rattache_mode = 'equipe', rattache_par = $3::uuid,
        rattache_le = now() where skool_member_id = $1`, F(7), X.id, R.COMPTE_BRICE)
      const { lien, refus } = await deciderPour(B.id)
      assert.equal(lien, null)
      assert.deepEqual(refus, ['membre_relie'])
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, B.id, F(7), 'nom', 'profil')).length, 0)
      ok('un membre deja rattache a un autre compte : pas touche')
    })

    // 3f. Une personne effacee ne revient pas.
    await point(tx, 'cas_oubli', async () => {
      await tx.$executeRawUnsafe(SQL_FICTIF_EMAIL, F(8), A.id)
      await tx.$executeRawUnsafe(`insert into public.cockpit_oublis_emails (email_hash)
        select public.cockpit_hash_email(u.email) from auth.users u where u.id = $1::uuid on conflict do nothing`, A.id)
      const { lien, refus } = await deciderPour(A.id)
      assert.equal(lien, null)
      assert.deepEqual(refus, ['oublie'])
      ok('une adresse dans la liste d oubli : aucun rattachement')
    })

    // 3g. Nom vide : un prenom sans nom, un nom sans prenom.
    await point(tx, 'cas_nom_vide', async () => {
      await tx.$executeRawUnsafe(`insert into public.academie_skool_membres (skool_member_id, prenom, nom, email, email_source, releve_le)
        select $1::text, p.first_name, '', null::text, 'aucune', '2026-11-15'::date from public.profiles p where p.id = $3::uuid
        union all select $2::text, '  ', p.last_name, null::text, 'aucune', '2026-11-15'::date from public.profiles p where p.id = $3::uuid`, F(9), F(10), B.id)
      assert.equal((await pairesDe(B.id)).length, 0)
      assert.ok(await refuse(tx, `update public.academie_skool_membres set profile_id = $2::uuid, rattache_mode = 'nom', rattache_source = 'profil',
        rattache_le = now() where skool_member_id = $1`, F(9), B.id), 'la base refuse un rattachement par nom sans nom')
      ok('nom vide : aucun couple, et la base refuse un rattachement par nom d un membre sans nom')
    })

    // 3h. Le filet a la main : rien si l'automatique l'a fait, avec auteur sinon.
    await point(tx, 'cas_franky', async () => {
      const f = R.RATTACHEMENTS_A_LA_MAIN[0]
      const auto = decision.rattachements.find(r => r.membre === f.membre)
      if (auto) {
        assert.equal(auto.compte, f.compte, 'l automatique retrouve le bon compte')
        assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_AUTO, auto.compte, auto.membre, auto.mode, auto.source)).length, 1)
        assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_A_LA_MAIN, f.membre, f.compte, f.par)).length, 0, 'le filet ne joue pas')
      }
      await tx.$executeRawUnsafe(`update public.academie_skool_membres set profile_id = null, rattache_mode = null, rattache_source = null,
        rattache_par = null, rattache_le = null where skool_member_id = $1`, f.membre)
      assert.equal(big(await tx.$queryRawUnsafe(R.SQL_RATTACHER_A_LA_MAIN, f.membre, f.compte, f.par)).length, 1)
      const [m] = big(await tx.$queryRawUnsafe(`select rattache_mode, rattache_par::text = $2 as par_brice, rattache_source is null as sans_source
        from public.academie_skool_membres where skool_member_id = $1`, f.membre, R.COMPTE_BRICE))
      assert.deepEqual(m, { rattache_mode: 'equipe', par_brice: true, sans_source: true })
      ok(`le filet a la main : ${auto ? `retrouve par l automatique (${auto.mode}, ${auto.source}), le filet ne rejoue pas ; ` : ''}seul, il pose equipe avec Brice pour auteur`)
    })

    // 4. Les contraintes du journal des reprises.
    const [unModule] = big(await tx.$queryRawUnsafe(`select id::text as id from public.academie_modules where statut = 'publie' order by ordre limit 1`))
    assert.ok(await refuse(tx, `insert into public.academie_reprises (user_id, module_id, portee, mode, par, verrou)
      values ($1::uuid, $2::uuid, 'module', 'auto', $1::uuid, 'module:x')`, A.id, unModule.id), 'auto avec auteur')
    assert.ok(await refuse(tx, `insert into public.academie_reprises (user_id, module_id, portee, mode, par, verrou)
      values ($1::uuid, $2::uuid, 'module', 'auto', null, null)`, A.id, unModule.id), 'auto sans verrou')
    assert.ok(await refuse(tx, `insert into public.academie_reprises (user_id, module_id, portee, mode, par)
      values ($1::uuid, $2::uuid, 'module', 'equipe', null)`, A.id, unModule.id), 'equipe sans auteur')
    assert.ok(await refuse(tx, `insert into public.academie_reprises (user_id, module_id, portee, mode, par, verrou)
      values ($1::uuid, $2::uuid, 'module', 'membre', null, 'module:x')`, A.id, unModule.id), 'membre sans auteur')
    ok('contraintes du journal : auto sans auteur et avec verrou, equipe et membre avec auteur')

    throw new Annulation()
  }, { timeout: 120_000, maxWait: 10_000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    const lignes = String(e?.message ?? e).split('\n').map(l => l.trim()).filter(Boolean)
    console.error(`ECHEC : ${(lignes.find(l => /Message|Expected|assert|ERROR/i.test(l)) ?? lignes[0] ?? '').slice(0, 300)}`)
    process.exitCode = 1
  }
}

const fin = await etat(prisma)
assert.deepEqual(fin, avant, 'rien ne reste apres l annulation')
console.log(`\n${etapes} etapes ok, ${((Date.now() - debut) / 1000).toFixed(1)} s du debut a l annulation ; apres : etat identique a avant (rien ne reste)`)
await prisma.$disconnect()
