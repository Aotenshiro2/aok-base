// Tests de NE PLUS CONTACTER (Brice, 27/11, ne-plus-contacter-pur.ts) :
// - demande nette : le marqueur ; « me desabonner » : la question de doute,
//   rien de pose ; une duree (vacances) ou un autre service : rien ;
// - la reponse a la question de doute (messages, abonnement, les deux, floue) ;
// - une personne marquee qui ecrit ensuite : le bot repond normalement (aucune
//   reponse, entree, reprise ni indicateur ne lit le marqueur) ;
// - le marqueur pose par le bot est celui que lit le lanceur des anciens
//   (bf-anciens.ts, lireEtatAncien) ; les conseils d'accueil le lisent ;
// - les textes (francais, courts, sans tiret long) et le cablage (outil de
//   l'agent, consigne, aucun bouton).
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-ne-plus-contacter.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import './resoudre-ts.mjs'

const N = await import('../src/lib/liveclub/ne-plus-contacter-pur.ts')
const PM = await import('../src/lib/liveclub/prompt-membre.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const type = (texte, o) => N.decisionNePlusContacter(texte, o).type
const Q = N.QUESTION_DOUTE_NE_PLUS_CONTACTER

function texteSain(t, nom) {
  assert.ok(!/[—–…“”•]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(t.length <= 160, `${nom} : trop long (${t.length})`)
}

bloc('demande nette : le marqueur', () => {
  for (const t of [
    'Ne me contactez plus.',
    'ne m\'écris plus',
    "Merci de ne plus m'envoyer de messages",
    'Je ne veux plus être contacté',
    'je veux plus recevoir vos promos',
    "Je ne souhaite plus recevoir de messages",
    'Arrêtez de me relancer svp',
    'stp arrête de m’écrire',
    'je ne veux plus de vos messages',
    'Plus de messages svp',
    'Bonjour, je souhaite ne plus être contacté, merci',
    'il ne faut plus me contacter',
    'Je veux me désabonner de vos messages',
  ]) assert.equal(type(t), 'poser', t)
  // Avec l'agent, pareil.
  assert.equal(type('Ne me contactez plus.', { appelModele: true }), 'poser')
})

bloc('« me desabonner » : la question de doute, rien de pose', () => {
  for (const t of ['je veux me désabonner', 'Comment je me désinscris ?', 'STOP', 'stop !', 'unsubscribe', 'Laissez-moi tranquille'])
    assert.equal(type(t), 'doute', t)
  // L'agent a vu une demande que la regle ne trouve pas nette : la question, jamais le marqueur.
  assert.equal(type("j'en ai marre de tout ça", { appelModele: true }), 'doute')
  // « me desabonner du Live Club » : l'arret habituel, pas de question.
  assert.equal(type('je veux me désabonner du Live Club'), 'abonnement')
  assert.equal(type('comment résilier, me désinscrire de mon abonnement ?'), 'abonnement')
})

bloc('faux positifs : une duree, un autre service, un mot de trading', () => {
  for (const t of [
    'Ne me contacte plus avant lundi, je suis en vacances',
    'ne m\'écrivez plus cette semaine svp',
    'Pas de messages pendant 2 semaines stp',
    'je ne veux plus être contacté jusqu’au 15',
    'Vantage ne m\'envoie plus de mails',
    "je ne veux plus recevoir les mails de Vantage",
    'il ne m\'écrit plus depuis hier',
    'je ne reçois plus de messages du groupe',
    'mon stop loss a sauté',
    'stop loss ou pas ?',
    'je ne veux plus perdre',
    'Bonjour, ma pause commence quand ?',
  ]) assert.equal(type(t), 'rien', t)
  // La meme duree avec l'agent : rien non plus (reponse normale), pas de question.
  assert.equal(type('Ne me contacte plus avant lundi, je suis en vacances', { appelModele: true }), 'rien')
  // Un autre service nomme, l'agent y a vu une demande : la question, jamais le marqueur.
  assert.equal(type('arrête de m\'envoyer tes offres de broker', { appelModele: true }), 'doute')
  // Rien d'ecrit, un texte geant : rien.
  assert.equal(type(''), 'rien')
  assert.equal(type(null), 'rien')
  assert.equal(type('ne me contactez plus '.repeat(200)), 'rien')
})

bloc('la reponse a la question de doute (une seule question)', () => {
  const o = { dernierBot: Q }
  assert.equal(type('les messages', o), 'poser')
  assert.equal(type('ne plus recevoir vos messages', o), 'poser')
  assert.equal(type('la deuxième', o), 'poser')
  assert.equal(type('2', o), 'poser')
  assert.equal(type('mon abonnement', o), 'abonnement')
  assert.equal(type('arrêter', o), 'abonnement')
  assert.equal(type('le premier', o), 'abonnement')
  assert.equal(type('les deux', o), 'poser_et_abonnement')
  assert.equal(type("l'abonnement et les messages", o), 'poser_et_abonnement')
  // Floue : pas de seconde question.
  assert.equal(type('bof je sais pas', o), 'rien')
  assert.equal(type('oui', o), 'rien')
  // Floue mais nette en elle-meme : comprise.
  assert.equal(type('ne me contactez plus', o), 'poser')
  // Les messages mais pour un temps : rien.
  assert.equal(type('les messages, pendant mes vacances', o), 'rien')
  // La question se retrouve dans un fil Support (boutons ajoutes au texte) et dans l'historique de l'agent.
  assert.equal(N.dernierMessageDuBot([{ role: 'assistant', content: `${Q}\n[Contacter l'équipe]` }, { role: 'user', content: 'les messages' }]), `${Q}\n[Contacter l'équipe]`)
  assert.ok(N.estQuestionDoute(`${Q}\n[Contacter l'équipe]`))
  assert.equal(N.dernierMessageDuBot([{ role: 'user', content: 'x' }]), null)
  assert.equal(N.dernierMessageDuBot(null), null)
  // Sans la question juste avant, « les messages » seul n'est pas une demande.
  assert.equal(type('les messages'), 'rien')
})

bloc('personne marquee qui ecrit ensuite : le bot repond normalement', () => {
  // Une question ordinaire ne touche jamais au marqueur, ni dans un sens ni dans l'autre.
  for (const t of ['Quand est le prochain live ?', 'je veux reprendre mon abonnement', "je veux l'indicateur d'Alex", 'Je veux revenir dans le groupe']) {
    assert.equal(type(t), 'rien', t)
    assert.equal(N.decisionReprendreMessages(t).type, 'rien', t)
  }
  // Aucun chemin de reponse, d'entree, de reprise ni d'indicateur ne LIT le marqueur pour
  // refuser quelque chose : le passage (conseils d'accueil) le lit, et le bot ne le lit
  // que devant une demande de levee (outil reprendre_nos_messages, et le meme geste pour
  // un compte non rattache).
  const dossier = new URL('../src/lib/liveclub/', import.meta.url)
  const lecteurs = readdirSync(dossier).filter(f => f.endsWith('.ts') && f !== 'ne-plus-contacter.ts')
    .filter(f => /nePlusContacterPose\(/.test(readFileSync(new URL(f, dossier), 'utf8'))).sort()
  assert.deepEqual(lecteurs, ['agent-membre.ts', 'bot-membre.ts', 'passage.ts'])
  const agent = lire('src/lib/liveclub/agent-membre.ts')
  assert.equal(agent.split('nePlusContacterPose(').length - 1, 1)
  const reprise = agent.slice(agent.indexOf('if (bloc.name === NOM_OUTIL_REPRENDRE_MESSAGES) {'))
  assert.ok(reprise.indexOf('nePlusContacterPose(') > 0 && reprise.indexOf('nePlusContacterPose(') < reprise.indexOf('\n      }\n'), 'agent : lu dans la levee seulement')
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.equal(bot.split('nePlusContacterPose(').length - 1, 1)
  assert.match(bot, /if \(reprise && reprise\.type !== 'rien' && await nePlusContacterPose\(u\.id\) === true\) \{/, 'bot : lu seulement devant une demande de levee')
  // Ni les regles brutes en SQL ailleurs que dans les modules du marqueur.
  const sql = readdirSync(dossier).filter(f => f.endsWith('.ts') && !f.startsWith('ne-plus-contacter'))
    .filter(f => /'ne_plus_contacter|REGLE_NE_PLUS_CONTACTER/.test(readFileSync(new URL(f, dossier), 'utf8')))
  assert.deepEqual(sql, [])
})

bloc('reprise d abonnement : normale', () => {
  // L'entree dans le groupe, les droits, la reprise et les liens de retour ne citent pas le marqueur.
  for (const f of ['droits.ts', 'accueil-groupe.ts', 'stripe.ts', 'passage-regles.ts', 'actions-membre.ts', 'avant-entree.ts', 'indicateur.ts']) {
    assert.ok(!/ne_plus_contacter|NePlusContacter|nePlusContacter/i.test(lire(`src/lib/liveclub/${f}`)), f)
  }
  // Une reprise d'abonnement ecrite part vers son parcours, pas vers le marqueur.
  assert.equal(type('je veux me réabonner'), 'rien')
  assert.equal(N.decisionReprendreMessages('je veux me réabonner').type, 'rien')
  assert.equal(type('je veux reprendre le Live Club, je me suis désabonné le mois dernier'), 'abonnement')
})

bloc('levee : demande nette, pas nette, question, jamais sur un arret', () => {
  const lev = (t, o) => N.decisionReprendreMessages(t, o).type
  for (const t of [
    'Tu peux me renvoyer vos promos',
    'vous pouvez de nouveau m\'envoyer les infos',
    'Je veux de nouveau recevoir les infos',
    'je veux bien recevoir vos messages',
    'Renvoie-moi tes messages stp',
    'tu peux me recontacter',
    'Recontactez-moi',
    'je souhaite être recontacté',
  ]) assert.equal(lev(t), 'lever', t)
  // Pas net : la question (sans agent seulement quand nos envois sont cites).
  assert.equal(lev("j'ai changé d'avis pour les messages"), 'doute')
  assert.equal(lev('finalement les promos ça m\'intéresse'), 'doute')
  assert.equal(lev("c'est bon maintenant", { appelModele: true }), 'doute')
  assert.equal(lev("c'est bon maintenant"), 'rien')
  // Une negation, un arret : jamais une levee.
  for (const t of ['ne me renvoie pas vos promos', 'je ne veux plus recevoir vos messages', 'Ne me contactez plus', 'stop'])
    assert.notEqual(lev(t), 'lever', t)
  assert.equal(lev('Ne me contactez plus', { appelModele: true }), 'rien')
  // La reponse a la question (une seule fois).
  const o = { dernierBot: N.QUESTION_REPRISE_MESSAGES }
  for (const t of ['oui', 'Oui stp', 'ok', "d'accord !", 'vas-y', 'volontiers']) assert.equal(lev(t, o), 'lever', t)
  for (const t of ['non', 'non merci', 'bof', 'je sais pas']) assert.equal(lev(t, o), 'rien', t)
  assert.ok(N.estQuestionReprise(`${N.QUESTION_REPRISE_MESSAGES}\n[Contacter l'équipe]`))
  // La question de la pose ne vaut pas question de levee.
  assert.equal(lev('oui', { dernierBot: N.QUESTION_DOUTE_NE_PLUS_CONTACTER }), 'rien')
})

bloc('etat courant : pose, levee, re-pose (le lanceur et les tips le suivent)', () => {
  const R = N.REGLE_NE_PLUS_CONTACTER
  const L = N.REGLE_NE_PLUS_CONTACTER_LEVE
  assert.equal(L, 'ne_plus_contacter_leve')
  const ligne = (id, regle, quand, o = {}) => ({ telegram_id: 42, geste: 'rappel', resultat: 'fait', regle, fait_le: quand, geste_id: id, ...o })
  const etat = (lignes) => N.etatCourantNePlusContacter(lignes, 42)
  assert.equal(etat([]), false)
  const pose = ligne(1, R, '2026-11-27T10:00:00Z')
  assert.equal(etat([pose]), true, 'pose')
  const levee = ligne(2, L, '2026-11-28T10:00:00Z')
  assert.equal(etat([pose, levee]), false, 'levee')
  const repose = ligne(3, R, '2026-11-29T10:00:00Z')
  assert.equal(etat([pose, levee, repose]), true, 're-pose')
  assert.equal(etat([repose, levee, pose]), true, "l'ordre des lignes ne compte pas")
  // Meme instant : geste_id departage.
  assert.equal(etat([ligne(5, R, '2026-11-27T10:00:00Z'), ligne(6, L, '2026-11-27T10:00:00Z')]), false)
  // Les autres lignes ne comptent pas : autre personne, autre geste, echec, autre regle.
  assert.equal(etat([pose, { ...levee, telegram_id: 7 }, { ...levee, geste: 'retrait' }, { ...levee, resultat: 'echec' }, { ...levee, regle: 'tip_accueil' }]), true)
  // L'ancien predicat du lanceur (exists sur la pose) se trompe apres une levee : il faut l'etat courant.
  const ancien = (lignes) => lignes.some(g => g.telegram_id === 42 && g.geste === 'rappel' && g.regle === R && g.resultat === 'fait')
  assert.equal(ancien([pose, levee]), true)
  assert.equal(etat([pose, levee]), false)
})

bloc('le serveur ecrit et lit l etat courant (pose, levee, re-pose)', () => {
  const s = lire('src/lib/liveclub/ne-plus-contacter.ts')
  // L'etat courant en SQL : la derniere des deux regles, fait_le puis geste_id.
  assert.match(s, /select e\.regle = \$\{REGLE_NE_PLUS_CONTACTER\} from public\.cockpit_liveclub_gestes e\n\s+where e\.telegram_id = \$\{telegramId\}::bigint and e\.geste = 'rappel' and e\.resultat = 'fait'\n\s+and e\.regle in \(\$\{REGLE_NE_PLUS_CONTACTER\}, \$\{REGLE_NE_PLUS_CONTACTER_LEVE\}\)\n\s+order by e\.fait_le desc, e\.geste_id desc\n\s+limit 1\), false\)/)
  // Une ecriture : geste 'rappel', resultat 'fait', la regle voulue, seulement si l'etat courant est l'inverse.
  assert.match(s, /insert into public\.cockpit_liveclub_gestes \(telegram_id, geste, resultat, acteur, regle, details\)\n\s+select \$\{telegramId\}::bigint, 'rappel', 'fait', \$\{ACTEUR_BOT_MEMBRE\}, \$\{regle\}/)
  assert.match(s, /where \$\{sqlNePlusContacter\(telegramId\)\} = \$\{attendu\}/)
  assert.match(s, /pg_advisory_xact_lock\(hashtextextended\(\$\{`liveclub:ne_plus_contacter:\$\{telegramId\}`\}/)
  // Pose : etat attendu false (donc re-pose apres une levee) ; levee : etat attendu true.
  assert.match(s, /ecrire\(telegramId, REGLE_NE_PLUS_CONTACTER, false,/)
  assert.match(s, /ecrire\(telegramId, REGLE_NE_PLUS_CONTACTER_LEVE, true,/)
  // Aucune suppression.
  assert.ok(!/delete from|update public\.cockpit_liveclub_gestes/i.test(s))
  // La lecture : l'etat courant.
  assert.match(s, /select \$\{sqlNePlusContacter\(telegramId\)\} as pose/)
  // Rejoue : la suite d'ecritures que le serveur autorise, appliquee a un journal en memoire.
  const journal = []
  let id = 0
  const ecrire = (regle, attendu, quand) => {
    if (N.etatCourantNePlusContacter(journal, 42) !== attendu) return 'deja'
    journal.push({ telegram_id: 42, geste: 'rappel', resultat: 'fait', regle, fait_le: quand, geste_id: ++id })
    return 'ecrit'
  }
  const poser = (q) => ecrire(N.REGLE_NE_PLUS_CONTACTER, false, q)
  const lever = (q) => ecrire(N.REGLE_NE_PLUS_CONTACTER_LEVE, true, q)
  assert.equal(lever('2026-11-26T09:00:00Z'), 'deja', 'rien a lever')
  assert.equal(poser('2026-11-27T09:00:00Z'), 'ecrit')
  assert.equal(poser('2026-11-27T09:01:00Z'), 'deja', 'une seule pose')
  assert.equal(lever('2026-11-28T09:00:00Z'), 'ecrit')
  assert.equal(lever('2026-11-28T09:01:00Z'), 'deja', 'une seule levee')
  assert.equal(poser('2026-11-29T09:00:00Z'), 'ecrit', 're-pose apres levee')
  assert.equal(journal.length, 3)
  assert.equal(N.etatCourantNePlusContacter(journal, 42), true)
})

bloc('le lanceur des anciens et les tips lisent l etat courant', () => {
  assert.equal(N.REGLE_NE_PLUS_CONTACTER, 'ne_plus_contacter')
  assert.deepEqual(N.detailsMarqueur('agent', new Date('2026-11-27T10:00:00Z')), { origine: 'agent', demande_le: '2026-11-27' })
  // Les conseils d'accueil du passage lisent l'etat courant (nePlusContacterPose) avant tout envoi.
  const p = lire('src/lib/liveclub/passage.ts')
  assert.match(p, /const nePlus = await nePlusContacterPose\(tid\)\n\s+if \(nePlus === null\) \{ s\.inconnus\+\+; return \}\n\s+if \(nePlus\) \{ s\.ne_plus_contacter\+\+; return \}/)
  assert.ok(p.indexOf('nePlusContacterPose(tid)') < p.indexOf("cle: `liveclub:tip_accueil:"), 'lu avant la reservation du conseil')
  // Le lanceur (branche bf-anciens, worktree voisin, non poussee, pas touchee ici) : meme regle ;
  // sa condition doit passer a l'etat courant (sqlNePlusContacter).
  const voisin = new URL('../../journal-bf-anciens/src/lib/liveclub/', import.meta.url)
  if (existsSync(new URL('bf-anciens.ts', voisin))) {
    const pur = readFileSync(new URL('bf-anciens-pur.ts', voisin), 'utf8')
    const serveur = readFileSync(new URL('bf-anciens.ts', voisin), 'utf8')
    assert.match(pur, /export const REGLE_NE_PLUS_CONTACTER = 'ne_plus_contacter'/)
    if (/sqlNePlusContacter|ne_plus_contacter_leve|REGLE_NE_PLUS_CONTACTER_LEVE/.test(serveur)) {
      console.log('    (lanceur bf-anciens relu : il lit l etat courant)')
    } else {
      assert.match(serveur, /g\.geste = 'rappel' and g\.regle = \$\{REGLE_NE_PLUS_CONTACTER\}\s+and g\.resultat = 'fait'/)
      console.log('    A CHANGER dans bf-anciens : lireEtatAncien lit encore « exists » (une levee y resterait exclue) ; remplacer par sqlNePlusContacter')
    }
  } else {
    console.log('    (lanceur bf-anciens absent : etat courant rejoue seulement)')
  }
})

bloc('textes du bot', () => {
  texteSain(N.TEXTE_NE_PLUS_CONTACTER_NOTE, 'confirmation')
  texteSain(N.QUESTION_DOUTE_NE_PLUS_CONTACTER, 'question')
  texteSain(N.TEXTE_NE_PLUS_CONTACTER_PANNE, 'panne')
  assert.match(N.TEXTE_NE_PLUS_CONTACTER_NOTE, /Tu peux toujours m'écrire/)
  assert.match(N.QUESTION_DOUTE_NE_PLUS_CONTACTER, /abonnement.*messages \?$/)
  texteSain(N.TEXTE_REPRISE_MESSAGES_NOTE, 'confirmation de la levee')
  texteSain(N.QUESTION_REPRISE_MESSAGES, 'question de la levee')
  assert.ok(!/\bvous\b/i.test(N.TEXTE_NE_PLUS_CONTACTER_NOTE + N.QUESTION_DOUTE_NE_PLUS_CONTACTER + N.TEXTE_REPRISE_MESSAGES_NOTE + N.QUESTION_REPRISE_MESSAGES), 'tutoiement')
})

bloc('cablage : outil de l agent, consigne, aucun bouton', () => {
  for (const nom of [N.NOM_OUTIL_NE_PLUS_CONTACTER, N.NOM_OUTIL_REPRENDRE_MESSAGES]) {
    const outil = PM.OUTILS_MEMBRE.find(o => o.name === nom)
    assert.ok(outil, nom)
    assert.deepEqual(outil.input_schema.properties, {})
  }
  assert.ok(PM.SYSTEM_PROMPT_MEMBRE.includes(N.CONSIGNE_NE_PLUS_CONTACTER))
  assert.ok(N.CONSIGNE_NE_PLUS_CONTACTER.includes(N.NOM_OUTIL_REPRENDRE_MESSAGES))
  assert.match(N.CONSIGNE_NE_PLUS_CONTACTER, /Tu ne proposes jamais l'une ou l'autre possibilité/)
  assert.match(N.CONSIGNE_NE_PLUS_CONTACTER, /il garde le groupe/)
  const agent = lire('src/lib/liveclub/agent-membre.ts')
  assert.match(agent, /decisionNePlusContacter\(question, \{ dernierBot: dernierMessageDuBot\(historique\), appelModele: true \}\)/)
  assert.match(agent, /if \(prudence && \(bloc\.name === NOM_OUTIL_NE_PLUS_CONTACTER \|\| bloc\.name === NOM_OUTIL_REPRENDRE_MESSAGES\)\) \{\n\s+resultats\.push\(\{ type: 'tool_result', tool_use_id: bloc\.id, content: JSON\.stringify\(REFUS_PRUDENCE_MEMBRE\) \}\)/, 'refuse sous prudence')
  // Le refus sous prudence passe AVANT le traitement de l'outil.
  const refus = agent.indexOf('prudence && (bloc.name === NOM_OUTIL_NE_PLUS_CONTACTER')
  assert.ok(refus > 0 && refus < agent.indexOf('if (bloc.name === NOM_OUTIL_NE_PLUS_CONTACTER) {'))
  assert.ok(refus < agent.indexOf('if (bloc.name === NOM_OUTIL_REPRENDRE_MESSAGES) {'))
  assert.match(agent, /decisionReprendreMessages\(question, \{ dernierBot: dernierMessageDuBot\(historique\), appelModele: true \}\)/)
  // (eval NP02) « me desabonner » seul : proposer_arret intercepte, la question de doute d'abord.
  assert.match(agent, /if \(type === 'arret' && decisionNePlusContacter\(question, \{ dernierBot: dernierMessageDuBot\(historique\) \}\)\.type === 'doute'\) \{\n\s+return \{ texte: QUESTION_DOUTE_NE_PLUS_CONTACTER, \.\.\.drapeau\(\) \}/)
  assert.ok(agent.indexOf("if (type === 'arret' && decisionNePlusContacter") < agent.indexOf('const prep = await preparerAction('), 'avant toute proposition')
  // Apres la reponse « mon abonnement », plus de question : l'arret habituel.
  assert.equal(N.decisionNePlusContacter('mon abonnement', { dernierBot: N.QUESTION_DOUTE_NE_PLUS_CONTACTER }).type, 'abonnement')
  assert.equal(N.decisionNePlusContacter('je veux arrêter mon abonnement').type, 'rien')
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.match(bot, /decisionNePlusContacter\(texte, \{ dernierBot: dernierMessageDuBot\(etat\?\.messages\) \}\)/)
  // Aucun bouton : ni dans les claviers, ni dans un callback.
  const tg = lire('src/lib/liveclub/telegram.ts') + bot
  assert.ok(!/(desabonn|ne_plus_contacter|ne plus recevoir|reprendre_nos_messages)[^\n]*callback_data|callback_data[^\n]*(desabonn|ne_plus|reprendre_nos)/i.test(tg))
  assert.ok(!/clavier\w*\([^)]*\)[^\n]*(NE_PLUS|REPRISE_MESSAGES)|(NE_PLUS|REPRISE_MESSAGES)[^\n]*clavier(?!Equipe)/.test(bot))
})

console.log(`\n${n} blocs ok`)
