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
  // Une question ordinaire ne touche jamais au marqueur.
  for (const t of ['Quand est le prochain live ?', 'je veux reprendre mon abonnement', "je veux l'indicateur d'Alex", 'Je veux revenir dans le groupe'])
    assert.equal(type(t), 'rien', t)
  // Aucun chemin de reponse, d'entree, de reprise ni d'indicateur ne LIT le marqueur :
  // seul le passage (conseils d'accueil) appelle nePlusContacterPose.
  const dossier = new URL('../src/lib/liveclub/', import.meta.url)
  const lecteurs = readdirSync(dossier).filter(f => f.endsWith('.ts') && f !== 'ne-plus-contacter.ts')
    .filter(f => /nePlusContacterPose/.test(readFileSync(new URL(f, dossier), 'utf8')))
  assert.deepEqual(lecteurs, ['passage.ts'])
  // Ni la regle brute en SQL ailleurs que dans les modules du marqueur.
  const sql = readdirSync(dossier).filter(f => f.endsWith('.ts') && !f.startsWith('ne-plus-contacter'))
    .filter(f => /regle = 'ne_plus_contacter'|REGLE_NE_PLUS_CONTACTER/.test(readFileSync(new URL(f, dossier), 'utf8')))
  assert.deepEqual(sql, [])
})

bloc('reprise d abonnement : normale', () => {
  // L'entree dans le groupe, les droits, la reprise et les liens de retour ne citent pas le marqueur.
  for (const f of ['droits.ts', 'accueil-groupe.ts', 'stripe.ts', 'passage-regles.ts', 'actions-membre.ts', 'avant-entree.ts', 'indicateur.ts']) {
    assert.ok(!/ne_plus_contacter|NePlusContacter|nePlusContacter/i.test(lire(`src/lib/liveclub/${f}`)), f)
  }
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  // Dans bot-membre, le marqueur n'est que POSE (compte non rattache), jamais lu pour refuser quelque chose.
  assert.ok(!/nePlusContacterPose/.test(bot))
  // Une reprise ecrite a l'agent part vers l'agent, pas vers le marqueur.
  assert.equal(type('je veux me réabonner'), 'rien')
  assert.equal(type('je veux reprendre le Live Club, je me suis désabonné le mois dernier'), 'abonnement')
})

bloc('le lanceur des anciens lit le marqueur pose par le bot', () => {
  assert.equal(N.REGLE_NE_PLUS_CONTACTER, 'ne_plus_contacter')
  const s = lire('src/lib/liveclub/ne-plus-contacter.ts')
  // L'ecriture : geste 'rappel', resultat 'fait', la regle, la personne.
  assert.match(s, /insert into public\.cockpit_liveclub_gestes \(telegram_id, geste, resultat, acteur, regle, details\)/)
  assert.match(s, /select \$\{telegramId\}::bigint, 'rappel', 'fait', \$\{ACTEUR_BOT_MEMBRE\}, \$\{REGLE_NE_PLUS_CONTACTER\}/)
  // La lecture du passage : le meme predicat que le lanceur.
  assert.match(s, /g\.geste = 'rappel'\s+and g\.regle = \$\{REGLE_NE_PLUS_CONTACTER\} and g\.resultat = 'fait'/)
  // Le predicat du lanceur (bf-anciens.ts, lireEtatAncien, 27/11), rejoue sur la ligne que le bot ecrit.
  const lanceurLit = (lignes, tid) => lignes.some(g => g.telegram_id === tid && g.geste === 'rappel' && g.regle === 'ne_plus_contacter' && g.resultat === 'fait')
  const ligneDuBot = { telegram_id: 42, geste: 'rappel', resultat: 'fait', acteur: 'bot:membre', regle: N.REGLE_NE_PLUS_CONTACTER, details: N.detailsMarqueur('agent', new Date('2026-11-27T10:00:00Z')) }
  assert.ok(lanceurLit([ligneDuBot], 42))
  assert.ok(!lanceurLit([ligneDuBot], 43))
  assert.deepEqual(ligneDuBot.details, { origine: 'agent', demande_le: '2026-11-27' })
  // Le lanceur lui-meme, s'il est la (branche bf-anciens, worktree voisin) : la meme regle, le meme predicat.
  const voisin = new URL('../../journal-bf-anciens/src/lib/liveclub/', import.meta.url)
  if (existsSync(new URL('bf-anciens.ts', voisin))) {
    const pur = readFileSync(new URL('bf-anciens-pur.ts', voisin), 'utf8')
    const serveur = readFileSync(new URL('bf-anciens.ts', voisin), 'utf8')
    assert.match(pur, /export const REGLE_NE_PLUS_CONTACTER = 'ne_plus_contacter'/)
    assert.match(serveur, /g\.geste = 'rappel' and g\.regle = \$\{REGLE_NE_PLUS_CONTACTER\}\s+and g\.resultat = 'fait'/)
    console.log('    (lanceur bf-anciens relu dans le worktree voisin : meme regle, meme predicat)')
  } else {
    console.log('    (lanceur bf-anciens absent : predicat rejoue seulement)')
  }
  // Les conseils d'accueil du passage lisent le marqueur avant tout envoi.
  const p = lire('src/lib/liveclub/passage.ts')
  assert.match(p, /const nePlus = await nePlusContacterPose\(tid\)\n\s+if \(nePlus === null\) \{ s\.inconnus\+\+; return \}\n\s+if \(nePlus\) \{ s\.ne_plus_contacter\+\+; return \}/)
  assert.ok(p.indexOf('nePlusContacterPose(tid)') < p.indexOf("cle: `liveclub:tip_accueil:"), 'lu avant la reservation du conseil')
})

bloc('textes du bot', () => {
  texteSain(N.TEXTE_NE_PLUS_CONTACTER_NOTE, 'confirmation')
  texteSain(N.QUESTION_DOUTE_NE_PLUS_CONTACTER, 'question')
  texteSain(N.TEXTE_NE_PLUS_CONTACTER_PANNE, 'panne')
  assert.match(N.TEXTE_NE_PLUS_CONTACTER_NOTE, /Tu peux toujours m'écrire/)
  assert.match(N.QUESTION_DOUTE_NE_PLUS_CONTACTER, /abonnement.*messages \?$/)
  assert.ok(!/\bvous\b/i.test(N.TEXTE_NE_PLUS_CONTACTER_NOTE + N.QUESTION_DOUTE_NE_PLUS_CONTACTER), 'tutoiement')
})

bloc('cablage : outil de l agent, consigne, aucun bouton', () => {
  const outil = PM.OUTILS_MEMBRE.find(o => o.name === N.NOM_OUTIL_NE_PLUS_CONTACTER)
  assert.ok(outil, 'outil dans OUTILS_MEMBRE')
  assert.deepEqual(outil.input_schema.properties, {})
  assert.ok(PM.SYSTEM_PROMPT_MEMBRE.includes(N.CONSIGNE_NE_PLUS_CONTACTER))
  assert.match(N.CONSIGNE_NE_PLUS_CONTACTER, /Tu ne proposes jamais cette possibilité/)
  assert.match(N.CONSIGNE_NE_PLUS_CONTACTER, /il garde le groupe/)
  const agent = lire('src/lib/liveclub/agent-membre.ts')
  assert.match(agent, /decisionNePlusContacter\(question, \{ dernierBot: dernierMessageDuBot\(historique\), appelModele: true \}\)/)
  assert.match(agent, /if \(prudence && bloc\.name === NOM_OUTIL_NE_PLUS_CONTACTER\) \{\n\s+resultats\.push\(\{ type: 'tool_result', tool_use_id: bloc\.id, content: JSON\.stringify\(REFUS_PRUDENCE_MEMBRE\) \}\)/, 'refuse sous prudence')
  // Le refus sous prudence passe AVANT le traitement de l'outil.
  assert.ok(agent.indexOf('prudence && bloc.name === NOM_OUTIL_NE_PLUS_CONTACTER') < agent.indexOf('if (bloc.name === NOM_OUTIL_NE_PLUS_CONTACTER) {'))
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.match(bot, /decisionNePlusContacter\(texte, \{ dernierBot: dernierMessageDuBot\(etat\?\.messages\) \}\)/)
  // Aucun bouton : ni dans les claviers, ni dans un callback.
  const tg = lire('src/lib/liveclub/telegram.ts') + bot
  assert.ok(!/(desabonn|ne_plus_contacter|ne plus recevoir)[^\n]*callback_data|callback_data[^\n]*(desabonn|ne_plus)/i.test(tg))
  assert.ok(!/clavier\w*\([^)]*\)[^\n]*NE_PLUS|NE_PLUS[^\n]*clavier(?!Equipe)/.test(bot))
})

console.log(`\n${n} blocs ok`)
