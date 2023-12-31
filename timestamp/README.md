# Simple timestamp service

This is a small Node.js application hosting a simple REST API
to create and verify cryptographically signed timestamps. The
server also hosts the documentation as its landing page.

## API

### `GET` — `/v1/api/cert`
Get the public key of the service, to verify a ticket yourself. The key
is returned as a plain text PEM key file. The endpoint returns the
currently used key by default. Other keys can be accessed by using their
UUID as a path parameter (file name).

### `GET` — `/v1/api/ticket`
Get a new signed ticket of the current date and time. Custom data can be
added by providing query parameters. The ticket is returned as JSON.

### `POST` — `/v1/api/verify`
Verify whether a ticket posted to the endpoint as a JSON body is valid.
A textual response is generated in case of an invalid ticket.

## Setup
Clone the repository, and install the required dependency with `npm`.
The system expects a `.env` file for configuration. An example file is
shown below.

```env
KEYS_DIR="keys"
KEY_PAIR_MAX_AGE="90"
ISSUER_ID="your.domain.com/v1"
HOME_PAGE= ""
ERROR_404_PAGE= ""
ERROR_500_PAGE= ""
PUBLIC_DIR= ""
ALL_VALIDATION_ERRORS= "false"
CUSTOM_DATA_LIMIT= "1000"
PORT="3000"
MQTT_BROKER="mqtt://localhost"
MQTT_CLIENT="timestamp"
MQTT_USERNAME="testuser"
MQTT_PASSWORD="1234"
MQTT_TOPIC="/logging/timestamp"
```

Key sets are changed automatically and stored in the `KEY_DIR`. If the
directory is empty, a new key set is automatically created on startup.
Keep paths to hosted webpages empty to use the provided markup files.

## License
This project was created by PreyMa and is licensed under the MIT license.
