import type { Messages } from "./types";

const messages = {
  "app.title": "MDB — Espacio de trabajo de bases de datos",
  "app.workbench": "Espacio de trabajo de bases de datos",
  "app.client": "Cliente de escritorio de bases de datos",
  "nav.databaseNavigation": "Navegación de bases de datos",
  "nav.connections": "Conexiones",
  "nav.newConnection": "Nueva conexión",
  "nav.noConnections": "Aún no hay conexiones",
  "nav.addServer": "Añade MySQL o abre un archivo SQLite",
  "nav.startBrowsing": "para explorar los datos",
  "nav.filterTables": "Filtrar tablas",
  "nav.filterPlaceholder": "Filtrar tablas…",
  "nav.view": "Vista",
  "nav.loading": "Cargando…",
  "nav.noMatchingTables": "No hay tablas coincidentes",
  "nav.noTables": "No hay tablas accesibles",
  "nav.noDatabases": "No hay bases de datos accesibles",
  "nav.localProfiles": "Conexiones guardadas en este equipo",
  "nav.help": "Ayuda",
  "nav.language": "Idioma",
  "workspace.title": "Área de trabajo",
  "workspace.views": "Vistas del área de trabajo",
  "workspace.sql": "Consulta SQL",
  "workspace.structure": "Estructura de tabla",
  "workspace.noDatabase": "Ninguna base de datos seleccionada",
  "workspace.refreshCatalog": "Actualizar catálogo de bases de datos",
  "workspace.disconnect": "Desconectar",
  "status.disconnected": "Sin conexión",
  "status.connected": "Conectado",
  "status.connecting": "Conectando",
  "status.loadingTables": "Cargando catálogo de tablas",
  "status.loadingStructure": "Leyendo estructura de tabla",
  "status.loadingData": "Leyendo datos de tabla",
  "status.runningSQL": "Ejecutando SQL",
  "status.refreshingCatalog": "Actualizando catálogo",
  "status.disconnecting": "Desconectando",
  "status.tlsEnabled": "TLS activado",
  "status.tlsDisabled": "TLS desactivado",
  "welcome.kicker": "Tus bases de datos, en un solo lugar",
  "welcome.title": "Empieza con una conexión",
  "welcome.description": "Explora estructuras y datos, y ejecuta SQL.",
  "welcome.clientDescription":
    "Un cliente de escritorio de bases de datos ligero y práctico.",
  "welcome.newConnection": "Nueva conexión de base de datos",
  "welcome.editor": "Editor SQL",
  "welcome.browse": "Explorador de datos",
  "help.title": "Tus datos, a tu alcance",
  "help.close": "Cerrar ayuda",
  "help.start":
    "Crea una conexión y selecciona una base de datos y una tabla. Usa ⌘ / Ctrl + Enter en el editor SQL; si seleccionas texto, solo se ejecuta esa selección.",
  "help.limits":
    "Los scripts SQL usan los permisos de la base conectada. Las escrituras modifican directamente la base. Los scripts no se agrupan automáticamente en una transacción; tras un error, comprueba las escrituras y el estado de la transacción. Las tablas muestran 100 filas por página y las consultas hasta 1.000 filas y 4 MiB. Reduce el alcance o añade LIMIT para ver un resultado completo.",
  "help.session":
    "Solo hay una sesión activa. Cambiar o desconectar la finaliza y revierte las transacciones sin confirmar al cerrar la conexión. El orden de paginación puede variar sin clave primaria o con cambios concurrentes.",
  "editor.region": "Editor SQL",
  "editor.title": "Editor de consultas",
  "editor.supportsScripts": "Admite scripts SQL",
  "editor.run": "Ejecutar SQL",
  "editor.selectionHint": "Solo se ejecuta el texto seleccionado",
  "editor.shortcut": "⌘ / Ctrl + Enter para ejecutar",
  "table.fieldsHint": "Campos, tipos y claves",
  "table.approxRows": "Filas aprox.: {count}",
  "table.browse": "Explorador de datos",
  "table.openSQL": "Abrir en SQL",
  "table.refresh": "Actualizar tabla",
  "result.region": "Área de resultados",
  "result.title": "Resultados",
  "result.rows": "Filas: {count}",
  "result.fields": "Columnas: {count}",
  "result.affected": "Filas afectadas: {count}",
  "result.previousPage": "Página anterior",
  "result.nextPage": "Página siguiente",
  "result.page": "Página {page}",
  "result.set": "Resultado {index}",
  "result.limit":
    "Se alcanzó el límite (1.000 filas / 4 MiB / 20 conjuntos). Los resultados están incompletos; reduce el alcance.",
  "result.waiting": "Esperando tu primera consulta",
  "result.waitingHint":
    "Escribe SQL arriba y ejecútalo para ver los resultados aquí.",
  "result.complete": "Ejecución completada",
  "result.gridLabel": "Resultados de consulta; desplazamiento horizontal",
  "result.rowNumber": "Número de fila",
  "result.emptyString": "Cadena vacía",
  "result.tooLarge": "El resultado supera el límite",
  "result.noRecords": "No se devolvieron registros",
  "result.narrowHint": "Reduce el alcance y vuelve a ejecutar.",
  "result.emptyHint":
    "Se muestra la estructura de columnas; este conjunto está vacío.",
  "connection.settings": "Configuración de conexión",
  "connection.subtitle": "Conecta a tu base de datos",
  "connection.close": "Cerrar configuración de conexión",
  "connection.defaultName": "MySQL local",
  "connection.name": "Nombre de conexión",
  "connection.host": "Servidor",
  "connection.port": "Puerto",
  "connection.username": "Usuario",
  "connection.password": "Contraseña",
  "connection.passwordPlaceholder":
    "Se guarda localmente para futuras conexiones",
  "connection.database": "Base de datos predeterminada",
  "connection.optional": "Opcional",
  "connection.databasePlaceholder":
    "Déjalo vacío para explorar las bases accesibles",
  "connection.tls": "Usar TLS y verificar el certificado del servidor",
  "connection.privacy":
    "Desactiva TLS solo en localhost o redes de confianza. Las contraseñas se guardan en el almacén de credenciales del sistema.",
  "connection.disconnectFirst": "Desconecta primero",
  "connection.deleteHint": "Eliminar los datos de conexión guardados",
  "connection.delete": "Eliminar conexión",
  "connection.test": "Probar conexión",
  "connection.save": "Guardar y conectar",
  "connection.testSuccess": "Conexión correcta · {engine} {version}",
  "error.close": "Cerrar error",
  "error.readProfiles": "No se pudo leer la configuración: {message}",
  "error.invalidProfiles":
    "La configuración local no es válida. Se conserva el original; respalda o repara mdb.connections.v1.",
  "error.desktopRequired":
    "Conecta desde la aplicación de escritorio MDB. El navegador solo muestra la interfaz. Ejecuta npm run tauri dev para iniciar la aplicación.",
  "error.requiredFields":
    "Completa el nombre de conexión y los ajustes obligatorios de la base de datos.",
  "error.invalidIdentifier":
    "Los nombres de bases y tablas no pueden estar vacíos ni contener NUL.",
  "error.invalidConnection":
    "Introduce un servidor, un usuario y un puerto válido.",
  "error.connectTimeout":
    "La conexión agotó el tiempo (10 segundos). Revisa el servidor, el puerto y la red.",
  "error.closeTimeout":
    "La prueba fue correcta, pero se agotó el tiempo al cerrar la conexión.",
  "error.disconnectTimeout":
    "La sesión local se cerró; el servidor no confirmó a tiempo.",
  "error.invalidSQL": "SQL no puede estar vacío ni superar 1 MiB.",
  "error.sessionExpired": "La conexión ha caducado. Vuelve a conectar.",
  "error.queryTimeout":
    "La consulta superó 30 segundos y se cerró la conexión. El servidor puede seguir ejecutándola; las escrituras podrían haberse aplicado. Verifica el resultado antes de repetir.",
  "error.partialExecution":
    "Las instrucciones anteriores pueden haberse ejecutado. Comprueba las escrituras y el estado de la transacción antes de continuar.",
  "error.outcomeUnknown":
    "El resultado es incierto. Verifica el estado del servidor antes de repetir.",
  "warning.tableCatalog":
    "El catálogo de tablas supera el límite. Consulta information_schema con SQL para obtenerlo completo.",
  "warning.databaseCatalog":
    "El catálogo de bases supera el límite. Usa SQL para obtenerlo completo.",
  "status.loadingCredentials": "Leyendo la contraseña guardada",
  "status.deletingConnection": "Eliminando conexión",
  "connection.edit": "Editar conexión {name}",
  "connection.connectHint": "Haz doble clic o pulsa Enter para conectar",
  "error.credentialAccess":
    "No se puede acceder al almacén de credenciales del sistema. Desbloquéalo e inténtalo de nuevo.",
  "connection.engine": "Tipo de base de datos",
  "connection.sqliteFile": "Archivo de base de datos SQLite",
  "connection.sqlitePathPlaceholder":
    "Ruta absoluta de un archivo .sqlite o .db existente",
  "connection.selectFile": "Seleccionar archivo de base de datos",
  "connection.sqliteDefaultName": "SQLite local",
  "connection.sqliteNote":
    "Abre un archivo SQLite existente. Las lecturas y escrituras actúan directamente sobre este archivo.",
  "error.invalidSqliteFile":
    "Selecciona un archivo SQLite existente con una ruta absoluta.",
  "error.sqliteTimeout":
    "La consulta SQLite superó los 30 segundos y se interrumpió; la conexión se cerró. Las instrucciones anteriores pueden haber escrito datos. Comprueba el resultado antes de actuar de nuevo.",
  "error.databaseTaskFailed":
    "El proceso de trabajo de la base de datos falló. Vuelve a conectar.",
  "editor.sqliteScope": "Ámbito SQL nativo de SQLite",
  "editor.sqliteContext": "Explorar {database} no cambia cómo se resuelven los nombres de tabla sin calificar. Use nombres con esquema, como {database}.table, para indicar la base de datos.",
  "error.profileRestore": "No se pudieron restaurar los ajustes tras un error de credenciales. Mantenga este diálogo abierto y vuelva a guardar o eliminar antes de reconectar.",
} satisfies Messages;

export default messages;
