# QrJoke

Une blague d'informaticien : un écran (ton PC ou un smartphone) s'appaire avec un **code à 2 chiffres** ou un **QR code**, passe en plein écran, puis tu lui envoies des blagues depuis ta **régie**.

Tout se passe dans une page web ouverte volontairement. Le serveur ne contrôle ni le PC ni le téléphone, seulement le contenu de cette page.

## Deux versions

| | Version Netlify (`site/`) | Version locale (`server.js` + `public/`) |
|---|---|---|
| Hébergement | Netlify, 100 % statique | Ton PC, sur ton réseau Wi-Fi |
| Temps réel | Broker MQTT public (`wss://broker.emqx.io:8084/mqtt`) | Serveur Socket.IO |
| Appairage | Code à 2 chiffres ou QR | Code à 2 chiffres ou QR |
| Accès à la régie | Lien avec le salon, sans mot de passe | Mot de passe |
| Marche hors de chez toi | Oui, depuis n'importe quel réseau | Non, même réseau seulement |

### Version Netlify (codes à 2 chiffres)
1. Ouvre la **régie** : `https://<ton-site>.netlify.app/remote`. Section **Appairer un écran** : elle propose un code libre (ex. `42`), ou tape le tien. Elle affiche le lien, un bouton Copier, la commande kiosque et le QR.
2. **PC** : va sur `https://<ton-site>.netlify.app/42` (ou ouvre la page, tape `42`), puis **Démarrer** / Entrée : plein écran, écran d'attente noir. Mode kiosque sans geste : `chrome.exe --kiosk "https://<ton-site>.netlify.app/42?auto=1"`.
3. **Smartphone** : scanne le QR (c'est le même lien `/42`), puis un tap sur **Démarrer**.
4. L'écran apparaît dans la régie (« Code 42 · PC · Chrome · plein écran ✅ »). Un seul écran : sélectionné d'office. Plusieurs : « Tous les écrans » par défaut, ou choisis-en un.

- **Un code = un seul écran** : un 2e navigateur qui tente `/42` reçoit « Ce code est déjà utilisé ». Le même navigateur peut reprendre son code (la page la plus récente garde la place). « Libérer » dans la régie rend le code.
- **Salon (optionnel)** : tout le monde partage par défaut un salon commun sur le broker public. Si quelqu'un d'autre utilise l'app et te gêne, donne un nom de salon à la régie : les liens deviennent `/42?room=ton-nom`.
- **Erreur système (faux plantage)** : section dédiée de la régie, version Netlify uniquement. Liste déroulante : **Auto** (chaque écran affiche l'erreur de son propre système : PC Windows → écran bleu, Mac → écran de redémarrage multilingue, Android → « Appli Système ne répond pas », iPhone/iPad → alerte iOS, autres systèmes → écran bleu) ou un **choix manuel** qui force le même écran partout. Au bout du délai choisi, ou après un clic (Android, iPhone) ou une touche (Mac), un message « Blague ! » apparaît (modifiable), puis retour à l'écran d'attente. Les écrans sont dessinés en HTML/CSS (`site/screens.js`) : aucune image, aucun logo, aucun numéro de support ni champ à remplir.
- **Autre broker** : `?broker=wss://...` (mémorisé aussi).
- Le broker est public et sans compte, et il n'y a que 100 codes : n'importe qui peut deviner un code libre et afficher un message. Chaque écran valide ce qu'il reçoit (liste blanche, valeurs bornées, texte seul, jamais de HTML), donc le pire cas reste un message à l'écran.
- Pas de build : le dossier `site/` est publié tel quel (`netlify.toml`, qui redirige `/42` vers la page d'appairage). `site/jokes.json` est une copie de `jokes.json` (un test vérifie qu'ils sont identiques). `site/vendor/` contient les bibliothèques `mqtt.js` et `qrcode` déjà prêtes.

### Version locale
## Démarrage

```bash
npm install
ADMIN_PASSWORD=monmotdepasse npm start   # PORT=3000 par défaut
```

Le serveur affiche trois choses dans la console :

- le **récepteur** : `http://<ip>:3000/` (la page à ouvrir sur l'écran)
- la **régie** : `http://<ip>:3000/remote`
- le **mot de passe** de la régie (généré au hasard si `ADMIN_PASSWORD` n'est pas défini)

## Utilisation

### Mode PC
1. Sur le PC, ouvre le récepteur, tape le code à 2 chiffres (ex. `42`) et appuie sur **Entrée**. La page passe en plein écran à cet instant (c'est ton geste qui l'autorise) et affiche un écran d'attente noir.
2. Laisse la personne s'installer.
3. Depuis ton téléphone ou un autre PC, ouvre la régie, choisis la cible `42` et lance les blagues.

Mode kiosque (plein écran sans aucun geste) :

```bash
chrome.exe --kiosk "http://<ip>:3000/?wait=black"
msedge.exe --kiosk "http://<ip>:3000/?wait=black" --edge-kiosk-type=fullscreen
```

`?wait=white` donne un écran d'attente blanc au lieu de noir.

### Mode smartphone
1. Dans la régie, section **Appairer un smartphone**, clique sur « Code libre » : un QR code s'affiche (l'URL est `/r/<code>`).
2. Le téléphone scanne, la page s'ouvre avec le code déjà rempli, **un tap** passe en plein écran.
3. Tu lances les blagues comme pour le PC.

Sur **iPhone**, Safari n'autorise pas le vrai plein écran sur une page web : la scène couvre alors tout l'écran, mais les barres du navigateur peuvent rester visibles.

### Régie
- **Cible** : un code précis ou « Tous les écrans ». La régie indique si chaque écran est bien en plein écran.
- **Blagues** : les boutons viennent de `jokes.json`.
- **Texte libre** : message, effet, couleurs, taille, durée, son, vibration (Ctrl+Entrée pour envoyer).
- **Retour à l'écran d'attente** : efface la blague en cours.
- **Libérer** : libère un code et renvoie le récepteur à l'écran d'appairage.

## Sorties de secours (côté écran)
- **5 clics** dans le coin haut-gauche, ou **Échap trois fois** : le récepteur se déconnecte et quitte le plein écran.
- `Échap` quitte aussi le plein écran du navigateur ; en kiosque, `Alt+F4` ferme la fenêtre.

## Ajouter tes blagues
Édite `jokes.json` (rechargé à chaque ouverture de la régie, pas de redémarrage). Exemple :

```json
{ "id": "perso", "label": "Ma blague", "emoji": "🎭",
  "joke": { "type": "typewriter", "text": "Salut\nça va ?", "bg": "#000000", "fg": "#ffffff", "size": 6, "duration": 10 } }
```

Types : `text`, `typewriter`, `countdown`, `loading`, `runaway`, `shake`, `flip`, `confetti`, `blackout`, `clear` (et `oserror` avec `os` = `auto`, `windows`, `mac`, `android` ou `iphone`, version Netlify uniquement).

| Champ | Rôle |
|---|---|
| `text` | Texte principal. Pour `countdown`, c'est le message révélé à la fin ; pour `loading` et `runaway`, le titre. |
| `final` | Message final de `loading` et `runaway`. |
| `button` | Texte du bouton de `runaway`. |
| `steps` | Étapes affichées pendant `loading`. |
| `from` | Départ du `countdown`. |
| `seconds` | Durée de `loading`, `shake`, `confetti`. |
| `speed` | Millisecondes par lettre pour `typewriter`. |
| `emoji`, `bg`, `fg` | Emoji, fond et couleur du texte. |
| `size` | Taille du texte en vmin (1 à 40). |
| `duration` | Retour automatique à l'attente après N secondes (0 = reste affiché). |
| `sound` | `horn`, `sad`, `ding`, `boing`. |
| `vibrate`, `confetti` | Booléens. |

Le serveur filtre tous les champs (liste blanche, valeurs bornées) et le récepteur n'utilise jamais `innerHTML`.

## Protocole Socket.IO

**Récepteur** (namespace par défaut)
- `join {code, clientId, kind}` → `{ok}` ou `{ok:false, error: 'occupied' | 'invalid'}`
- `state {fullscreen}`, `leave`
- reçoit `joke {...}` et `kick`

**Régie** (namespace `/remote`, `auth: {password}`)
- reçoit `receivers [{code, kind, online, fullscreen, since}]`
- `send {code | 'all', joke}`, `release code`, `free-code`

## Sécurité
- Un code à 2 chiffres (100 possibilités) se devine facilement, donc **un code = un seul récepteur** : un 2e navigateur reçoit « code déjà utilisé ». Seul le même navigateur peut reprendre son code après une coupure.
- La régie est protégée par mot de passe, avec blocage d'une minute après 5 échecs par IP.
- `IDLE_MINUTES=60` libère automatiquement les codes inactifs (désactivé par défaut pour ne pas casser une attente longue).
- Pense à rester sur ton réseau local. Pour l'exposer sur internet, passe par HTTPS (variable `PUBLIC_URL` pour le QR).
- Reste sur des blagues gentilles et avec des gens qui ont l'humour : pas de faux écran d'antivirus, de paiement ou de connexion.

## Tests
```bash
npm test   # serveur local (Socket.IO) + protocole MQTT contre un broker local simulé
```

## À faire
- Design des pages (récepteur et régie)
- Historique et favoris dans la régie
- Écran d'attente personnalisable
