import type { Messages } from "./types";

const messages = {
  "app.title": "MDB — Espace de travail de bases de données",
  "app.workbench": "Espace de travail de bases de données",
  "app.client": "Client de bureau de bases de données",
  "nav.databaseNavigation": "Navigation des bases de données",
  "nav.connections": "Connexions",
  "nav.newConnection": "Nouvelle connexion",
  "nav.noConnections": "Aucune connexion pour le moment",
  "nav.addServer": "Ajoutez MySQL ou ouvrez un fichier SQLite",
  "nav.startBrowsing": "pour explorer les données",
  "nav.filterTables": "Filtrer les tables",
  "nav.filterPlaceholder": "Filtrer les tables…",
  "nav.view": "Vue",
  "nav.loading": "Chargement…",
  "nav.noMatchingTables": "Aucune table correspondante",
  "nav.noTables": "Aucune table accessible",
  "nav.noDatabases": "Aucune base de données accessible",
  "nav.localProfiles": "Connexions enregistrées localement",
  "nav.help": "Aide",
  "nav.language": "Langue",
  "workspace.title": "Espace de travail",
  "workspace.views": "Vues de l’espace de travail",
  "workspace.sql": "Requête SQL",
  "workspace.structure": "Structure de la table",
  "workspace.noDatabase": "Aucune base de données sélectionnée",
  "workspace.refreshCatalog": "Actualiser le catalogue des bases de données",
  "workspace.disconnect": "Déconnecter",
  "status.disconnected": "Non connecté",
  "status.connected": "Connecté",
  "status.connecting": "Connexion en cours",
  "status.loadingTables": "Chargement du catalogue des tables",
  "status.loadingStructure": "Lecture de la structure de la table",
  "status.loadingData": "Lecture des données de la table",
  "status.runningSQL": "Exécution SQL en cours",
  "status.refreshingCatalog": "Actualisation du catalogue",
  "status.disconnecting": "Déconnexion en cours",
  "status.tlsEnabled": "TLS activé",
  "status.tlsDisabled": "TLS désactivé",
  "welcome.kicker": "Vos bases de données, dans un seul espace",
  "welcome.title": "Commencez par une connexion",
  "welcome.description":
    "Explorez les structures et les données, et exécutez du SQL.",
  "welcome.clientDescription":
    "Un client de bureau de bases de données léger et pratique.",
  "welcome.newConnection": "Nouvelle connexion de base de données",
  "welcome.editor": "Éditeur SQL",
  "welcome.browse": "Explorateur de données",
  "help.title": "Vos données, à portée de main",
  "help.close": "Fermer l’aide",
  "help.start":
    "Créez une connexion, puis sélectionnez une base de données et une table. Utilisez ⌘ / Ctrl + Enter dans l’éditeur SQL ; si du texte est sélectionné, seule cette sélection est exécutée.",
  "help.limits":
    "Les scripts SQL utilisent les droits de la base connectée. Les écritures modifient directement la base. Les scripts ne sont pas automatiquement regroupés dans une transaction ; après une erreur, vérifiez les écritures et l’état de la transaction. Les tables affichent 100 lignes par page et les requêtes jusqu’à 1 000 lignes et 4 MiB. Réduisez la portée ou ajoutez LIMIT pour afficher un résultat complet.",
  "help.session":
    "Une seule session est active. Changer de connexion ou se déconnecter termine la session et annule les transactions non validées à la fermeture. L’ordre des pages peut varier sans clé primaire ou en cas de modifications simultanées.",
  "editor.region": "Éditeur SQL",
  "editor.title": "Éditeur de requêtes",
  "editor.supportsScripts": "Scripts SQL pris en charge",
  "editor.run": "Exécuter SQL",
  "editor.selectionHint": "Seul le texte sélectionné est exécuté",
  "editor.shortcut": "⌘ / Ctrl + Enter pour exécuter",
  "table.fieldsHint": "Champs, types et clés",
  "table.approxRows": "Lignes estimées : {count}",
  "table.browse": "Explorateur de données",
  "table.openSQL": "Ouvrir dans SQL",
  "table.refresh": "Actualiser la table",
  "result.region": "Zone de résultats",
  "result.title": "Résultats",
  "result.rows": "Lignes : {count}",
  "result.fields": "Colonnes : {count}",
  "result.affected": "Lignes affectées : {count}",
  "result.previousPage": "Page précédente",
  "result.nextPage": "Page suivante",
  "result.page": "Page {page}",
  "result.set": "Résultat {index}",
  "result.limit":
    "Limite d’affichage atteinte (1 000 lignes / 4 MiB / 20 jeux de résultats). Résultats incomplets ; réduisez la portée.",
  "result.waiting": "En attente de votre première requête",
  "result.waitingHint":
    "Écrivez du SQL ci-dessus, puis exécutez-le pour voir les résultats ici.",
  "result.complete": "Exécution terminée",
  "result.gridLabel": "Résultats de requête ; défilement horizontal",
  "result.rowNumber": "Numéro de ligne",
  "result.emptyString": "Chaîne vide",
  "result.tooLarge": "Le résultat dépasse la limite",
  "result.noRecords": "Aucun enregistrement renvoyé",
  "result.narrowHint": "Réduisez la portée et relancez la requête.",
  "result.emptyHint":
    "La structure des colonnes est affichée ; ce jeu de résultats est vide.",
  "connection.settings": "Paramètres de connexion",
  "connection.subtitle": "Connectez-vous à votre base de données",
  "connection.close": "Fermer les paramètres de connexion",
  "connection.defaultName": "MySQL local",
  "connection.name": "Nom de la connexion",
  "connection.host": "Hôte",
  "connection.port": "Port",
  "connection.username": "Nom d’utilisateur",
  "connection.password": "Mot de passe",
  "connection.passwordPlaceholder":
    "Enregistré localement pour les prochaines connexions",
  "connection.database": "Base de données par défaut",
  "connection.optional": "Facultatif",
  "connection.databasePlaceholder":
    "Laissez vide pour explorer les bases accessibles",
  "connection.tls": "Utiliser TLS et vérifier le certificat du serveur",
  "connection.privacy":
    "Désactivez TLS uniquement en local ou sur un réseau fiable. Les mots de passe sont enregistrés dans le gestionnaire d’identifiants du système.",
  "connection.disconnectFirst": "Déconnectez-vous d’abord",
  "connection.deleteHint": "Supprimer les paramètres de connexion enregistrés",
  "connection.delete": "Supprimer la connexion",
  "connection.test": "Tester la connexion",
  "connection.save": "Enregistrer et connecter",
  "connection.testSuccess": "Connexion réussie · {engine} {version}",
  "error.close": "Fermer l’erreur",
  "error.readProfiles": "Impossible de lire les paramètres : {message}",
  "error.invalidProfiles":
    "Les paramètres locaux sont invalides. L’original est conservé ; sauvegardez ou réparez mdb.connections.v1.",
  "error.desktopRequired":
    "Connectez-vous depuis l’application de bureau MDB. Le navigateur affiche seulement l’interface. Lancez npm run tauri dev pour démarrer l’application.",
  "error.requiredFields":
    "Renseignez le nom de connexion et les paramètres obligatoires de la base de données.",
  "error.invalidIdentifier":
    "Les noms des bases et des tables ne peuvent être vides ni contenir NUL.",
  "error.invalidConnection":
    "Saisissez un hôte, un nom d’utilisateur et un port valide.",
  "error.connectTimeout":
    "Délai de connexion dépassé (10 secondes). Vérifiez l’hôte, le port et le réseau.",
  "error.closeTimeout":
    "Le test a réussi, mais la fermeture de la connexion a dépassé le délai.",
  "error.disconnectTimeout":
    "La session locale est fermée ; le serveur n’a pas confirmé à temps.",
  "error.invalidSQL": "Le SQL ne peut être vide ni dépasser 1 MiB.",
  "error.sessionExpired": "La connexion a expiré. Reconnectez-vous.",
  "error.queryTimeout":
    "La requête a dépassé 30 secondes et la connexion a été fermée. Le serveur peut encore l’exécuter ; des écritures peuvent avoir été appliquées. Vérifiez le résultat avant toute nouvelle action.",
  "error.partialExecution":
    "Les instructions précédentes peuvent avoir été exécutées. Vérifiez les écritures et l’état de la transaction avant de continuer.",
  "error.outcomeUnknown":
    "Le résultat est incertain. Vérifiez l’état du serveur avant toute nouvelle action.",
  "warning.tableCatalog":
    "Le catalogue des tables dépasse la limite. Interrogez information_schema en SQL pour obtenir le catalogue complet.",
  "warning.databaseCatalog":
    "Le catalogue des bases dépasse la limite. Utilisez SQL pour obtenir le catalogue complet.",
  "status.loadingCredentials": "Lecture du mot de passe enregistré",
  "status.deletingConnection": "Suppression de la connexion",
  "connection.edit": "Modifier la connexion {name}",
  "connection.connectHint":
    "Double-cliquez ou appuyez sur Enter pour connecter",
  "error.credentialAccess":
    "Impossible d’accéder au gestionnaire d’identifiants du système. Déverrouillez-le et réessayez.",
  "connection.engine": "Type de base de données",
  "connection.sqliteFile": "Fichier de base de données SQLite",
  "connection.sqlitePathPlaceholder":
    "Chemin absolu d’un fichier .sqlite ou .db existant",
  "connection.selectFile": "Choisir le fichier de base de données",
  "connection.sqliteDefaultName": "SQLite local",
  "connection.sqliteNote":
    "Ouvre un fichier SQLite existant. Les lectures et écritures agissent directement sur ce fichier.",
  "error.invalidSqliteFile":
    "Choisissez un fichier SQLite existant avec un chemin absolu.",
  "error.sqliteTimeout":
    "La requête SQLite a dépassé 30 secondes et a été interrompue ; la connexion est fermée. Les instructions précédentes peuvent avoir écrit des données. Vérifiez le résultat avant toute nouvelle action.",
  "error.databaseTaskFailed":
    "Le traitement de la base de données a échoué. Reconnectez-vous.",
  "editor.sqliteScope": "Portée SQL native de SQLite",
  "editor.sqliteContext": "Parcourir {database} ne change pas la résolution des noms de table non qualifiés. Utilisez un nom avec schéma, comme {database}.table, pour cibler la base voulue.",
  "error.profileRestore": "Impossible de restaurer les paramètres après une erreur des identifiants. Gardez ce dialogue ouvert et réessayez l’enregistrement ou la suppression avant de reconnecter.",
} satisfies Messages;

export default messages;
