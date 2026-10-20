#ifndef SECRETS_EXAMPLE_H
#define SECRETS_EXAMPLE_H

// ============================================================================
// PLANTILLA DE CREDENCIALES (SEGURO PARA REPOSITORIOS PÚBLICOS)
// Copia este archivo con el nombre "secrets.h" y completa con tus datos reales.
// ============================================================================

// Wi-Fi Local
const char *SECRET_WIFI_SSID = "TU_WIFI_SSID";
const char *SECRET_WIFI_PASS = "TU_WIFI_PASSWORD";

// Ubidots IoT
const char *SECRET_UBIDOTS_TOKEN = "TU_UBIDOTS_TOKEN";

// Bot de Telegram
const char *SECRET_TELEGRAM_BOT_TOKEN = "TU_TELEGRAM_BOT_TOKEN";
const char *SECRET_TELEGRAM_CHAT_ID   = "TU_TELEGRAM_CHAT_ID";

// Servidor en la Nube (Amazon Lightsail)
const char *SECRET_LIGHTSAIL_API_URL  = "http://TU_IP_ESTATICA/api/sensors/data";

#endif // SECRETS_EXAMPLE_H
