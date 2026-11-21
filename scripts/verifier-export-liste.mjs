// Verification HORS LIGNE de l'export d'une liste par Agent AOK (21/11/2026) :
// le CSV (src/lib/agent-export-pur.ts), et le cablage (meme lecture que
// requete_sql, refus sous prudence et hors Telegram, fichier envoye dans le
// fil du tour seulement, consigne du prompt). Aucune base, aucun reseau.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-export-liste.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const E = await import('../src/lib/agent-export-pur.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

bloc('le CSV : BOM, point-virgule, CRLF, en-tete, echappement', () => {
  const { csv, colonnes } = E.csvDeLignes([
    { nom: 'Ana Dupont', email: 'a@exemple.test', telegram: '@ana', depuis: new Date('2026-03-01T00:00:00Z'), montant: 89.5 },
    { nom: 'Lou "le roc"; B.', email: 'b@exemple.test', telegram: null, depuis: new Date('2026-04-02T10:20:30Z'), montant: 1000n },
  ])
  assert.deepEqual(colonnes, ['nom', 'email', 'telegram', 'depuis', 'montant'])
  assert.ok(csv.startsWith('﻿nom;email;telegram;depuis;montant\r\n'), JSON.stringify(csv.slice(0, 60)))
  const lignes = csv.slice(1).split('\r\n')
  assert.equal(lignes.length, 4, 'en-tete, deux lignes, fin de fichier')
  assert.equal(lignes[3], '')
  assert.equal(lignes[1], "Ana Dupont;a@exemple.test;'@ana;2026-03-01;89,5")
  assert.equal(lignes[2], '"Lou ""le roc""; B.";b@exemple.test;;2026-04-02 10:20:30;1000')
  // Retour a la ligne dans une cellule : entre guillemets.
  assert.equal(E.celluleCsv('a\nb'), '"a\nb"')
  // Pas de formule Excel depuis un texte de membre ; un nombre negatif reste un nombre.
  assert.equal(E.celluleCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(E.celluleCsv('+33 6 12'), "'+33 6 12")
  assert.equal(E.celluleCsv('@ana'), "'@ana")
  assert.equal(E.celluleCsv(-5), '-5')
  assert.equal(E.celluleCsv(true), 'oui')
  assert.equal(E.celluleCsv({ a: 1 }), '"{""a"":1}"')
  assert.equal(E.celluleCsv(undefined), '')
  // Colonnes vues plus loin : ajoutees, cellules vides avant.
  const t = E.csvDeLignes([{ a: 1 }, { a: 2, b: 'x' }])
  assert.deepEqual(t.colonnes, ['a', 'b'])
  assert.ok(t.csv.includes('\r\n1;\r\n2;x\r\n'))
})

bloc('un nom de membre en @ reste lisible dans la colonne telegram', () => {
  // L'apostrophe devant @ protege Excel ; elle est visible : c'est le prix assume.
  const { csv } = E.csvDeLignes([{ telegram: '@ana' }])
  assert.ok(csv.endsWith("'@ana\r\n"))
})

bloc('le nom du fichier : fabrique par le serveur, sans chemin ni lien', () => {
  const le = new Date('2026-11-21T23:30:00Z') // deja le 22 a Paris
  assert.equal(E.nomFichierExport('Résiliés Live Club', le), 'liste-resilies-live-club-2026-11-22.csv')
  assert.equal(E.nomFichierExport('../../etc/passwd', le), 'liste-etc-passwd-2026-11-22.csv')
  assert.equal(E.nomFichierExport('https://exemple.test/x?y=1', le), 'liste-https-exemple-test-x-y-1-2026-11-22.csv')
  assert.equal(E.nomFichierExport('', le), 'liste-export-2026-11-22.csv')
  assert.equal(E.nomFichierExport(undefined, le), 'liste-export-2026-11-22.csv')
  const long = E.nomFichierExport('a'.repeat(39) + ' bbbb', le)
  assert.ok(/^liste-[a-z0-9-]{1,40}-2026-11-22\.csv$/.test(long), long)
  assert.ok(!long.includes('--'), long)
})

bloc('ce que le modele recoit : nombre, colonnes, trois lignes, jamais la liste', () => {
  const lignes = Array.from({ length: 145 }, (_, i) => ({ nom: `Membre ${i}`, email: `m${i}@exemple.test`, telegram: `@m${i}` }))
  const r = JSON.parse(E.resumeExportPourModele({ lignes, colonnes: ['nom', 'email', 'telegram'], tronque: false, nom: 'liste-x.csv' }))
  assert.equal(r.lignes, 145)
  assert.deepEqual(r.colonnes, ['nom', 'email', 'telegram'])
  assert.equal(r.apercu.length, E.APERCU_EXPORT)
  assert.equal(E.APERCU_EXPORT, 3)
  assert.equal(r.plafond, undefined)
  const texte = JSON.stringify(r)
  assert.ok(!texte.includes('m3@exemple.test'), 'la 4e ligne ne repasse pas par le modele')
  assert.ok(texte.length < 1500, `${texte.length} caracteres`)
  const t = JSON.parse(E.resumeExportPourModele({ lignes: lignes.slice(0, 3), colonnes: ['nom'], tronque: true, nom: 'x.csv' }))
  assert.match(t.plafond, /5000/)
  assert.equal(E.PLAFOND_EXPORT, 5000)
  // Le cas de Melanie : 145 lignes a ~240 caracteres tiennent dans le fichier, pas dans 14 000 caracteres.
  const lourdes = Array.from({ length: 145 }, (_, i) => ({ nom: `Prénom Nom${i}`.padEnd(40, 'x'), email: `adresse.longue.${i}@exemple.test`.padEnd(60, 'y'), telegram: `@pseudo${i}`.padEnd(30, 'z'), telegram_id: 7000000000 + i, depuis: '2025-10-01' }))
  assert.ok(JSON.stringify(lourdes).length > 14000, 'le cas depasse bien la coupe de requete_sql')
  const { csv } = E.csvDeLignes(lourdes)
  assert.equal(csv.slice(1).split('\r\n').length, 147)
})

bloc('la legende et la note d un resultat tronque', () => {
  assert.equal(E.legendeExport({ lignes: 145, tronque: false }), "145 lignes. Fichier CSV, s'ouvre dans Excel.")
  assert.equal(E.legendeExport({ lignes: 1, tronque: false }), "1 ligne. Fichier CSV, s'ouvre dans Excel.")
  assert.ok(E.legendeExport({ lignes: 5000, tronque: true }).includes('plafond de 5000 atteint'))
  const coupe = E.noteResultatTronque({ lignes: 145, coupe: true })
  assert.ok(coupe.startsWith('[résultat tronqué : 145 lignes lues'), coupe)
  assert.match(coupe, /n'est PAS la liste complète/)
  assert.match(coupe, /count/)
  assert.ok(E.noteResultatTronque({ lignes: 200, coupe: false }).startsWith('[résultat tronqué : plafond de 200 lignes atteint'))
  for (const t of [coupe, E.legendeExport({ lignes: 3, tronque: true }), E.resumeExportPourModele({ lignes: [], colonnes: [], tronque: true, nom: 'x' })]) {
    assert.ok(!t.includes(String.fromCodePoint(0x2014)), 'jamais de tiret cadratin')
  }
})

bloc('le cablage : meme lecture que requete_sql, refus, destinataire, consigne', () => {
  const agent = lire('src/lib/agent-cockpit.ts')
  // Un seul chemin de lecture : verrou, read only, delai, vues du serveur, plafond.
  const lecture = agent.slice(agent.indexOf('async function lireLignesSql'), agent.indexOf('const PLAFOND_REQUETE'))
  assert.match(lecture, /const refus = verrouSql\(sql, \{ fonds \}\)/)
  assert.match(lecture, /set transaction read only/)
  assert.match(lecture, /statement_timeout = '8000ms'/)
  assert.match(lecture, /avecVuesServeur\(sql\)\}\) sous_requete limit \$\{borne\}/)
  assert.equal((agent.match(/set transaction read only/g) ?? []).length, 1, 'une seule transaction de lecture')
  assert.match(agent, /const lu = await lireLignesSql\(sql, fonds, PLAFOND_REQUETE\)/)
  assert.match(agent, /const lu = await lireLignesSql\(sql, fonds, PLAFOND_EXPORT \+ 1\)/)
  assert.match(agent, /const ex = await exporterListe\(bloc\.input, accesFonds\)/)
  // L'outil, sa description pour le filet des noms d'outils.
  assert.match(agent, /name: 'exporter_liste',/)
  assert.ok(AP.DESCRIPTIONS_OUTILS.exporter_liste)
  assert.equal(AP.sansNomsOutils('je passe par exporter_liste'), "je passe par l'export en fichier")
  // Refus : prudence, canal sans livraison, trop de fichiers. Fichier retenu si l'apercu est suspect.
  const h = agent.slice(agent.indexOf("if (bloc.name === 'exporter_liste') {"))
  assert.match(h.slice(0, 1600), /const refusExport = prudence \? REFUS_PRUDENCE\s+: !canal\.livraisonFichier \?/)
  assert.match(h.slice(0, 2600), /if \(ex\.fichier && !prudence\) fichiers\.push\(ex\.fichier\)/)
  assert.match(h.slice(0, 2600), /await surveillerResultat\(ex\.contenu\)/)
  assert.ok(agent.indexOf("if (bloc.name === 'exporter_liste') {") < agent.indexOf('const resultat = await executerSql(sql, accesFonds)'))
  // Le modele ne donne aucun destinataire : l'outil n'a que sql et titre.
  const outil = agent.slice(agent.indexOf("name: 'exporter_liste',"), agent.indexOf("name: 'exporter_liste',") + 1400)
  assert.match(outil, /required: \['sql', 'titre'\]/)
  assert.ok(!/chat_id|destinataire: \{|email: \{|url: \{/.test(outil), 'aucun champ de destinataire')
  // requete_sql : la coupe dit que ce n'est pas la liste complete.
  assert.match(agent, /noteResultatTronque\(\{ lignes: lu\.lignes\.length, coupe: true \}\)/)
  assert.match(agent, /resultat_tronque: resultat\.includes\('\[résultat tronqué'\)/)
  // La consigne du prompt.
  const prompt = agent.slice(agent.indexOf('const SYSTEM_PROMPT'), agent.indexOf('// L\'outil unique'))
  assert.match(prompt, /LES LISTES À REMETTRE \(21\/11/)
  assert.match(prompt, /ne le présente jamais comme complet\. Compte le vrai total \(select count\(\*\)\), annonce-le, et pour la liste passe par exporter_liste/)
  assert.match(prompt, /Le fichier part toujours à la personne qui te parle, et à elle seule/)
  // Telegram : livraison dans le fil du tour, apres la reponse ; la fenetre n'en a pas.
  const tg = lire('src/lib/agent-cockpit-telegram.ts')
  assert.match(tg, /livraisonFichier: true,/)
  assert.match(tg, /for \(const f of reponse\.fichiers \?\? \[\]\) await envoyerFichierExport\(chatId, f\)/)
  assert.equal((tg.match(/envoyerFichierExport\(/g) ?? []).length, 2, 'une definition, un appel')
  assert.ok(tg.indexOf('await envoyerFichierExport(chatId, f)') > tg.indexOf('await livrerReponse('), 'apres la reponse')
  const envoi = tg.slice(tg.indexOf('async function envoyerFichierExport'), tg.indexOf('const TEXTE_EXPORT_NON_PARTI'))
  assert.match(envoi, /form\.append\('chat_id', String\(chatId\)\)/)
  assert.match(envoi, /sendDocument/)
  assert.ok(!/f\.csv\)?\.slice|console\.\w+\([^)]*f\.csv/.test(envoi), 'le contenu du fichier ne va jamais au log')
  const web = lire('src/app/api/cockpit/agent/route.ts')
  assert.ok(!/livraisonFichier\s*:/.test(web), 'la fenetre du cockpit ne remet pas de fichier')
  assert.match(web, /delete reponse\.fichiers/)
})

console.log(`\n${n} blocs ok`)
process.exit(0)
