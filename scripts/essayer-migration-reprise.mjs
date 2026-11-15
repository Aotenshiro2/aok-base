/**
 * ESSAI de la migration 20261115180000_academie_reprise_progression.sql (la
 * reprise de la progression des membres de Skool, 15/11/2026) et des requetes
 * EXACTES de src/lib/academie/reprise-pur.ts, contre la vraie base, dans UNE
 * transaction TOUJOURS ANNULEE (lock_timeout 5 s, rien ne reste) :
 *   1. la migration, jouee deux fois (rejouable) : vu_par accepte 'reprise',
 *      RLS activee et forcee sur les trois tables, aucun droit pour anon,
 *      aucune ecriture pour authenticated ;
 *   2. l'import du fichier FICTIF des tests (membres et cours, deux fois :
 *      aucun doublon), les contraintes du rattachement (jamais par email une
 *      adresse ambigue, un rattachement a la main dit qui), le rattachement
 *      automatique (aucune adresse fictive ne correspond a un compte) ;
 *   3. l'historique (SQL_FAITS_REPRISE) d'un compte rattache a la main et d'un
 *      compte inconnu, son releve (SQL_RELEVE_DU_COMPTE) ;
 *   4. une reprise d'un compte d'essai (uuid invente, aucun compte) sur un vrai
 *      module : la ligne du journal, le « une fois » tenu par la base, les
 *      lecons cochees (une lecon deja vue par la mesure n'est pas touchee, ni
 *      terminee_le ni marquee_vue_le poses), aok_activite_par_jour qui ne
 *      compte que la lecon vraiment vue (aucun point), l'etat avant decochage ;
 *   5. LECTURES ET ECRITURES REJOUEES sous anon et authenticated (vrai sub) ;
 *   6. l'EFFACEMENT recree (cockpit_effacement_apercu sur le compte rattache,
 *      cockpit_effacer de niveau 3 sur une adresse FICTIVE, sans compte ni
 *      fiche) : les trois tables, les memes cles des deux cotes, l'adresse dans
 *      la liste d'oubli, l'import suivant qui ne recree pas la personne.
 * Puis la transaction est annulee, et on verifie hors transaction que rien
 * n'est reste (tables, contrainte, corps des deux fonctions, journal des
 * effacements, liste d'oubli). Aucune insertion dans academie_lectures (sa
 * sequence n'est pas transactionnelle). Aucun email ni identifiant complet
 * n'est affiche.
 *
 * Lancement (depuis apps/journal-d-etude ; worktree : AOK_WORKSPACE=<racine du workspace>) :
 *   node --env-file=.env --env-file=.env.local scripts/essayer-migration-reprise.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import * as R from '../src/lib/academie/reprise-pur.ts'
import * as P from '../src/lib/academie/pur.ts'
import * as Q from '../src/lib/academie/requetes.ts'

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261115180000_academie_reprise_progression.sql'
const candidats = [
  process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
  new URL(`../../../${MIGRATION}`, import.meta.url),
].filter(Boolean)
const fichier = candidats.find(u => existsSync(u))
if (!fichier) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)

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
const court = id => `${String(id).slice(0, 8)}...`
const motif = e => String(e?.message ?? e).split('\n').find(l => /permission|policy|violates|denied|row-level|check constraint|not-null|duplicate|unique/i.test(l))?.trim().slice(0, 110) ?? 'refus'
const big = v => JSON.parse(JSON.stringify(v, (k, x) => typeof x === 'bigint' ? Number(x) : x))

const etat = async c => big((await c.$queryRawUnsafe(`select
  to_regclass('public.academie_skool_membres')::text as membres,
  to_regclass('public.academie_progression_skool')::text as releve,
  to_regclass('public.academie_reprises')::text as reprises,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'academie_progression_vu_par_check') as vu_par,
  (select md5(prosrc) from pg_proc where oid = 'public.cockpit_effacer(integer,bigint[],uuid[],text[],text[],text)'::regprocedure) as effacer,
  (select md5(prosrc) from pg_proc where oid = 'public.cockpit_effacement_apercu(integer,bigint[],uuid[],text[],text[])'::regprocedure) as apercu,
  (select count(*) from public.cockpit_effacements)::int as effacements,
  (select count(*) from public.cockpit_oublis_emails)::int as oublis`))[0])

const U = 'e55a1000-0000-4000-8000-00000000000a' // compte d'essai invente (aucun compte du site)
const releve = R.lireReleveSkool(readFileSync(new URL('./fixtures/progression-skool/progression-skool-2026-11-15.csv', import.meta.url), 'utf8'))
const membres = [...R.membresDuReleve(releve.lignes).values()]
const RELEVE_LE = '2026-11-15'

async function commeRole(tx, role, sub, sql, ...params) {
  await tx.$executeRawUnsafe('savepoint role_essai')
  try {
    await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify(sub ? { sub, role } : { role }))
    await tx.$executeRawUnsafe(`set local role ${role}`)
    const r = await tx.$queryRawUnsafe(sql, ...params)
    return { lu: true, lignes: big(r) }
  } catch (e) {
    return { lu: false, motif: motif(e) }
  } finally {
    await tx.$executeRawUnsafe('rollback to savepoint role_essai')
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

const avant = await etat(prisma)
console.log(`avant : tables ${avant.membres ?? 'absentes'} / ${avant.releve ?? '-'} / ${avant.reprises ?? '-'} ; vu_par : ${avant.vu_par}`)
const debut = Date.now()

try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '20s'`)

    // 1. La migration, deux fois.
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    for (const o of ordres) await tx.$executeRawUnsafe(o)
    const apres = await etat(tx)
    assert.ok(apres.membres && apres.releve && apres.reprises)
    assert.match(apres.vu_par, /'reprise'/)
    const rls = big(await tx.$queryRawUnsafe(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('anon', c.oid, 'select') as anon_lit,
        has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
          or has_table_privilege('authenticated', c.oid, 'delete') as auth_ecrit,
        has_table_privilege('service_role', c.oid, 'delete') as service_efface
      from pg_class c where c.relname in ('academie_skool_membres', 'academie_progression_skool', 'academie_reprises')`))
    assert.equal(rls.length, 3)
    for (const t of rls) {
      assert.ok(t.relrowsecurity && t.relforcerowsecurity, `RLS forcee (${t.relname})`)
      assert.ok(!t.anon_lit && !t.auth_ecrit && !t.service_efface, `droits (${t.relname})`)
    }
    ok(`migration jouee deux fois (${ordres.length} ordres) : vu_par accepte 'reprise', RLS forcee, rien pour anon, aucune ecriture navigateur`)

    // 2. L'import du fichier fictif, deux fois.
    const importer = async () => {
      const m = await tx.$queryRawUnsafe(R.SQL_IMPORTER_MEMBRES,
        membres.map(x => x.skoolMemberId), membres.map(x => x.prenom), membres.map(x => x.nom), membres.map(x => x.email),
        membres.map(x => x.emailSource), membres.map(x => x.statut), membres.map(x => x.rejoint), RELEVE_LE)
      const c = await tx.$queryRawUnsafe(R.SQL_IMPORTER_COURS,
        releve.lignes.map(x => x.skoolMemberId), releve.lignes.map(x => x.coursId), releve.lignes.map(x => x.coursTitre),
        releve.lignes.map(x => x.terminees), releve.lignes.map(x => x.total), releve.lignes.map(x => x.pourcentage),
        releve.lignes.map(x => x.aAcces), RELEVE_LE)
      return { m: m.length, c: c.length }
    }
    const premier = await importer()
    const second = await importer()
    const [n] = big(await tx.$queryRawUnsafe(`select (select count(*) from public.academie_skool_membres)::int as m,
      (select count(*) from public.academie_progression_skool)::int as c`))
    assert.deepEqual(premier, { m: membres.length, c: releve.lignes.length })
    assert.deepEqual(second, { m: 0, c: 0 })
    assert.deepEqual(n, { m: membres.length, c: releve.lignes.length })
    const rattaches = await tx.$queryRawUnsafe(R.SQL_RATTACHER_PAR_EMAIL)
    assert.equal(rattaches.length, 0, 'aucune adresse fictive ne correspond a un compte')
    const adresses = await tx.$queryRawUnsafe(R.SQL_ADRESSES_RATTACHABLES, membres.map(x => x.email).filter(Boolean))
    assert.equal(adresses.length, 0)
    ok(`import du fichier fictif : ${premier.m} membres et ${premier.c} lignes, rejoue sans rien ecrire ni doubler ; aucun rattachement par email`)

    // Les contraintes du rattachement.
    // Un compte du site hors de l'equipe du cockpit (qui lirait tout) : le rattachement a la main de l'essai porte sur lui.
    const [compte] = big(await tx.$queryRawUnsafe(`select p.id::text as id from public.profiles p
      where not exists (select 1 from public.cockpit_allowlist a where a.user_id = p.id)
        and not exists (select 1 from public.academie_reprises r where r.user_id = p.id) order by p.id limit 1`))
    const C = compte.id
    const ambigu = membres.find(m => m.emailSource === R.SOURCE_AMBIGUE).skoolMemberId
    const lina = membres.find(m => m.historique && R.rattachableParEmail(m)).skoolMemberId
    assert.ok(await refuse(tx, `update public.academie_skool_membres set profile_id = $1::uuid, rattache_mode = 'email', rattache_le = now()
      where skool_member_id = $2`, C, ambigu), 'jamais par email une adresse ambigue')
    assert.ok(await refuse(tx, `update public.academie_skool_membres set profile_id = $1::uuid, rattache_mode = 'equipe', rattache_le = now()
      where skool_member_id = $2`, C, lina), 'a la main : qui')
    assert.ok(await refuse(tx, `update public.academie_skool_membres set profile_id = $1::uuid where skool_member_id = $2`, C, lina),
      'un rattachement dit comment et quand')
    await tx.$executeRawUnsafe(`update public.academie_skool_membres set profile_id = $1::uuid, rattache_mode = 'equipe',
      rattache_par = $1::uuid, rattache_le = now() where skool_member_id = $2`, C, lina)
    // Un nouvel import garde le rattachement a la main.
    await importer()
    const [garde] = big(await tx.$queryRawUnsafe(`select profile_id::text as p, rattache_mode from public.academie_skool_membres where skool_member_id = $1`, lina))
    assert.deepEqual(garde, { p: C, rattache_mode: 'equipe' })
    ok(`rattachement : ambigu refuse par email, a la main sans auteur refuse, a la main garde par un nouvel import (compte ${court(C)})`)

    // 3. L'historique.
    const [fC] = big(await tx.$queryRawUnsafe(R.SQL_FAITS_REPRISE, C))
    const [fU] = big(await tx.$queryRawUnsafe(R.SQL_FAITS_REPRISE, U))
    assert.equal(fC.releve_skool, true)
    assert.equal(fU.releve_skool, false)
    assert.equal(fU.ancien, false)
    assert.equal(fU.arrivee, null)
    const lignesC = big(await tx.$queryRawUnsafe(R.SQL_RELEVE_DU_COMPTE, C))
    assert.equal(lignesC.length, releve.lignes.filter(l => l.skoolMemberId === lina).length)
    ok(`historique : le compte rattache en a un (releve de ${lignesC.length} cours), le compte inconnu non`)

    // 4. Une reprise du compte d'essai sur un vrai module.
    const [mod] = big(await tx.$queryRawUnsafe(`select m.id::text as id, (select array_agg(l.id::text order by l.ordre) from public.academie_lecons l
        where l.module_id = m.id and l.statut = 'publie') as lecons,
        (select s.id::text from public.academie_sections s where s.module_id = m.id order by s.ordre limit 1) as section
      from public.academie_modules m where m.slug = 'la-formation-complete'`))
    const [A, B, Cl, D] = mod.lecons
    // A : vue par la mesure ; B : en cours ; C et D : jamais ouvertes.
    await tx.$executeRawUnsafe(`insert into public.academie_progression (user_id, lecon_id, secondes_vues, terminee_le, vu_le, vu_par, derniere_vue_le, nb_sessions)
      values ($1::uuid, $2::uuid, 900, now() - interval '2 days', now() - interval '2 days', 'mesure', now() - interval '2 days', 1),
             ($1::uuid, $3::uuid, 120, null, null, null, now() - interval '1 day', 1)`, U, A, B)
    const verrou = R.verrouReprise('cours', mod.id, null)
    const pose = big(await tx.$queryRawUnsafe(R.SQL_POSER_REPRISE, U, mod.id, null, 'module', verrou, 1, 48))
    assert.equal(pose.length, 1)
    assert.equal(big(await tx.$queryRawUnsafe(R.SQL_POSER_REPRISE, U, mod.id, null, 'module', verrou, 0, null)).length, 0, 'une fois')
    assert.equal(big(await tx.$queryRawUnsafe(R.SQL_POSER_REPRISE, U, mod.id, mod.section, 'section', R.verrouReprise('cours', mod.id, mod.section), 0, null)).length, 0,
      'une partie du meme cours : refusee aussi')
    const cochees = big(await tx.$queryRawUnsafe(R.SQL_COCHER_REPRISE, U, [A, B, Cl, D])).map(x => x.lecon_id).sort()
    assert.deepEqual(cochees, [B, Cl, D].sort())
    await tx.$executeRawUnsafe(R.SQL_COMPLETER_REPRISE, pose[0].id, cochees)
    const lignes = big(await tx.$queryRawUnsafe(`select lecon_id::text as l, vu_par, terminee_le is not null as preuve, marquee_vue_le is not null as clic,
        secondes_vues, nb_sessions from public.academie_progression where user_id = $1::uuid order by lecon_id`, U))
    const de = id => lignes.find(x => x.l === id)
    assert.deepEqual([de(A).vu_par, de(A).preuve], ['mesure', true])
    for (const id of [B, Cl, D]) {
      assert.equal(de(id).vu_par, 'reprise')
      assert.equal(de(id).preuve, false)
      assert.equal(de(id).clic, false)
    }
    assert.equal(de(B).secondes_vues, 120)
    assert.equal(de(Cl).nb_sessions, 0)
    const [journal] = big(await tx.$queryRawUnsafe(`select cardinality(lecons) as n, deja_vues, pourcentage_skool, mode, par::text = user_id::text as soi
      from public.academie_reprises where id = $1::uuid`, pose[0].id))
    assert.deepEqual(journal, { n: 3, deja_vues: 1, pourcentage_skool: 48, mode: 'membre', soi: true })
    // Une reprise de l'equipe (volet 3) : sans verrou, sans limite, qui l'a fait.
    await tx.$executeRawUnsafe(`insert into public.academie_reprises (user_id, module_id, portee, mode, par, note)
      values ($1::uuid, $2::uuid, 'module', 'equipe', $3::uuid, 'captures du membre (essai)')`, U, mod.id, C)
    assert.ok(await refuse(tx, `insert into public.academie_reprises (user_id, module_id, portee, mode, par, verrou)
      values ($1::uuid, $2::uuid, 'module', 'membre', $3::uuid, 'module:x')`, U, mod.id, C), 'mode membre : par = le membre')
    ok(`reprise : journal pose, une fois par cours tenu par la base, ${cochees.length} lecons cochees, la lecon vue par la mesure intacte, ni preuve ni clic`)

    // Aucun point : l'activite du jour ne compte que la lecon vraiment vue.
    const activite = big(await tx.$queryRawUnsafe(`select coalesce(sum(lecons), 0)::int as lecons from public.aok_activite_par_jour($1::uuid, 'Europe/Paris')`, U))
    assert.equal(activite[0].lecons, 1)
    ok('aucun point : aok_activite_par_jour compte 1 lecon (la mesure), 0 pour les 3 cochees par la reprise')

    // Le decochage : l'etat lu par la requete EXACTE du suivi, la regle pure, puis la ligne decochee (contraintes).
    const [e] = await tx.$queryRawUnsafe(Q.SQL_ETAT_SIGNAL_PROFONDEUR, U, Cl)
    assert.equal(e.nb_sessions, 0)
    const etatSuivi = {
      type: e.type, dureeS: e.duree_s, positionMaxS: e.position_max_s, dernierePositionS: e.derniere_position_s, secondesVues: e.secondes_vues,
      pourcentage: e.pourcentage, termineeLe: e.terminee_le, vuLe: e.vu_le, derniereVueLe: e.derniere_vue_le, dernierSignalLe: e.dernier_signal_le,
      nbSignaux: e.nb_signaux, maintenant: e.maintenant, profondeurMax: e.profondeur_max, mots: e.mots, nbSessions: e.nb_sessions,
    }
    assert.deepEqual(P.appliquerSignal(etatSuivi, { evenement: e.type === 'video' ? 'lecture' : 'texte', positionS: 30, secondes: 30, vu: true }),
      { refus: 'lien' }, 'aucun temps credite sans ouverture')
    const decoche = P.appliquerSignal(etatSuivi, { evenement: 'vu', positionS: null, secondes: null, vu: false })
    assert.equal(decoche.maj.vu, 'retirer')
    await tx.$executeRawUnsafe(`update public.academie_progression set vu_le = null, vu_par = null, marquee_vue_le = null
      where user_id = $1::uuid and lecon_id = $2::uuid`, U, Cl)
    const [apresDecoche] = big(await tx.$queryRawUnsafe(Q.SQL_PROGRESSION_COMPTE, U)).filter(x => x.lecon_id === Cl)
    assert.equal(P.etatLecon({ secondesVues: apresDecoche.secondes_vues, vuLe: apresDecoche.vu_le, nbSessions: apresDecoche.nb_sessions }), 'non_vu')
    ok('decochage : etat lu par SQL_ETAT_SIGNAL_PROFONDEUR (nb_sessions 0), signal de lecture refuse, decochee : non_vu (SQL_PROGRESSION_COMPTE)')

    // 5. Les roles du navigateur.
    const anon = await commeRole(tx, 'anon', null, 'select count(*)::int as n from public.academie_skool_membres')
    assert.equal(anon.lu, false)
    const etranger = await commeRole(tx, 'authenticated', U, 'select count(*)::int as n from public.academie_skool_membres')
    assert.equal(etranger.lignes?.[0]?.n, 0)
    const sien = await commeRole(tx, 'authenticated', C, 'select count(*)::int as n from public.academie_skool_membres')
    assert.equal(sien.lignes?.[0]?.n, 1)
    const sonReleve = await commeRole(tx, 'authenticated', C, 'select count(*)::int as n from public.academie_progression_skool')
    assert.equal(sonReleve.lignes?.[0]?.n, lignesC.length)
    const sesReprises = await commeRole(tx, 'authenticated', U, 'select count(*)::int as n from public.academie_reprises')
    assert.equal(sesReprises.lignes?.[0]?.n, 2)
    const autresReprises = await commeRole(tx, 'authenticated', C, 'select count(*)::int as n from public.academie_reprises')
    assert.equal(autresReprises.lignes?.[0]?.n, 0)
    const ecrire = await commeRole(tx, 'authenticated', U, `insert into public.academie_reprises (user_id, module_id, portee, mode, par, verrou)
      values ('${U}'::uuid, '${mod.id}'::uuid, 'module', 'membre', '${U}'::uuid, 'module:essai') returning id`)
    assert.equal(ecrire.lu, false)
    ok(`roles : anon refuse (${anon.motif}), un membre ne lit que ce qui est a lui, aucune ecriture navigateur (${ecrire.motif})`)

    // 6. L'effacement (niveau 3) connait les trois tables.
    // L'apercu (STABLE, rien n'est touche) d'un compte rattache : ses emails restent en base, passes par sous-requete.
    await tx.$executeRawUnsafe(`insert into public.academie_reprises (user_id, module_id, portee, mode, par, note)
      values ($1::uuid, $2::uuid, 'module', 'equipe', $1::uuid, 'essai effacement')`, C, mod.id)
    const [ap] = big(await tx.$queryRawUnsafe(`select public.cockpit_effacement_apercu(3, '{}'::bigint[], '{}'::uuid[],
        coalesce((select array_agg(lower(u.email)) from auth.users u where u.id = $1::uuid and u.email is not null), '{}'::text[]),
        '{}'::text[]) as a`, C))
    assert.equal(ap.a.efface.academie_reprises, 1)
    assert.equal(ap.a.efface.academie_membres_skool, 1, 'le membre de Skool rattache a la main')
    assert.equal(ap.a.efface.academie_releve_skool, lignesC.length)
    // Les cles d'avant sont toujours la.
    for (const k of ['academie_progression', 'academie_acces', 'skool_miroir', 'aok_comptes', 'journal_notes', 'fiche_membres']) {
      assert.ok(k in ap.a.efface, k)
    }
    // Un vrai cockpit_effacer de niveau 3 sur une adresse FICTIVE (aucun compte, aucune fiche) : son membre de Skool.
    const tom = membres.find(m => m.statut === 'parti' && m.email)
    const lignesTom = releve.lignes.filter(l => l.skoolMemberId === tom.skoolMemberId).length
    const [ef] = big(await tx.$queryRawUnsafe(`select public.cockpit_effacer(3, '{}'::bigint[], '{}'::uuid[], array[$1::text], '{}'::text[], 'essai reprise') as r`, tom.email))
    assert.equal(ef.r.efface.academie_membres_skool, 1)
    assert.equal(ef.r.efface.academie_releve_skool, lignesTom)
    assert.equal(ef.r.efface.academie_reprises, 0)
    assert.deepEqual(Object.keys(ef.r.efface).sort(), Object.keys(ap.a.efface).sort(), 'memes cles que l apercu')
    const [reste] = big(await tx.$queryRawUnsafe(`select
        (select count(*) from public.academie_skool_membres where skool_member_id = $1)::int as membre,
        (select count(*) from public.academie_progression_skool where skool_member_id = $1)::int as releve,
        exists (select 1 from public.cockpit_oublis_emails o where o.email_hash = public.cockpit_hash_email($2)) as oublie`,
      tom.skoolMemberId, tom.email))
    assert.deepEqual(reste, { membre: 0, releve: 0, oublie: true })
    // L'import suivant ne le recree pas (adresse dans la liste d'oubli), et ne double rien pour les autres.
    const apresEffacement = await importer()
    const [n2] = big(await tx.$queryRawUnsafe(`select (select count(*) from public.academie_skool_membres)::int as m,
      (select count(*) from public.academie_progression_skool)::int as c`))
    assert.deepEqual(apresEffacement, { m: 0, c: 0 })
    assert.deepEqual(n2, { m: membres.length - 1, c: releve.lignes.length - lignesTom })
    ok(`effacement : l apercu du compte rattache compte ses 3 tables, cockpit_effacer (niveau 3, adresse fictive) efface le membre de Skool et ses ${lignesTom} cours, memes cles que l apercu, l import ne le recree pas`)

    throw new Annulation()
  }, { timeout: 60_000, maxWait: 10_000 })
} catch (e) {
  if (!(e instanceof Annulation)) {
    console.error(`ECHEC : ${String(e?.message ?? e).split('\n').slice(0, 3).join(' ')}`)
    process.exitCode = 1
  }
}

const fin = await etat(prisma)
assert.deepEqual(fin, avant, 'rien ne reste apres l annulation')
console.log(`\n${etapes} etapes ok, ${((Date.now() - debut) / 1000).toFixed(1)} s du debut a l annulation ; apres : etat identique a avant (rien ne reste)`)
await prisma.$disconnect()
