#!/usr/bin/env bashio

export MQTTHOST=$(bashio::config "mqtt_host")
export MQTTPORT=$(bashio::config "mqtt_port")
export MQTTUSER=$(bashio::config "mqtt_user")
export MQTTPASSWORD=$(bashio::config "mqtt_password")

# The Supervisor only hands out the MQTT login once the broker add-on has published it as a service.
# If it isn't available at the moment this starts, falling straight back to an anonymous connection
# just gets "Not authorized" from the broker and a crash loop, with nothing saying why. So retry for
# a minute first, and log what the Supervisor actually answered (result/message only - never the
# data, which holds the password).
MQTT_SERVICE=false
if [[ "$MQTTHOST$MQTTPORT$MQTTUSER$MQTTPASSWORD" == *'<auto_detect>'* ]]; then
    for attempt in $(seq 1 12); do
        if bashio::services.available 'mqtt'; then
            MQTT_SERVICE=true
            break
        fi
        answer=$(curl -s -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" http://supervisor/services/mqtt | jq -r '"\(.result): \(.message // "")"' 2>&1 || true)
        echo "MQTT service not available from the Supervisor (attempt ${attempt}/12): ${answer}"
        if [ "$attempt" -lt 12 ]; then sleep 5; fi
    done
fi

if [ $MQTTHOST = '<auto_detect>' ]; then
    if [ "$MQTT_SERVICE" = true ]; then
        MQTTHOST=$(bashio::services mqtt "host")
	if [ $MQTTHOST = 'localhost' ] || [ $MQTTHOST = '127.0.0.1' ]; then
	    echo "Discovered invalid value for MQTT host: ${MQTTHOST}"
	    echo "Overriding with default alias for Mosquitto MQTT addon"
	    MQTTHOST="core-mosquitto"
	fi
        echo "Using discovered MQTT Host: ${MQTTHOST}"
    else
    	echo "No Home Assistant MQTT service found, using defaults"
        MQTTHOST="172.30.32.1"
        echo "Using default MQTT Host: ${MQTTHOST}"
    fi
else
    echo "Using configured MQTT Host: ${MQTTHOST}"
fi

if [ $MQTTPORT = '<auto_detect>' ]; then
    if [ "$MQTT_SERVICE" = true ]; then
        MQTTPORT=$(bashio::services mqtt "port")
        echo "Using discovered MQTT Port: ${MQTTPORT}"
    else
        MQTTPORT="1883"
        echo "Using default MQTT Port: ${MQTTPORT}"
    fi
else
    echo "Using configured MQTT Port: ${MQTTPORT}"
fi

if [ $MQTTUSER = '<auto_detect>' ]; then
    if [ "$MQTT_SERVICE" = true ]; then
        MQTTUSER=$(bashio::services mqtt "username")
        echo "Using discovered MQTT User: ${MQTTUSER}"
    else
        MQTTUSER=""
        echo "Using anonymous MQTT connection"
    fi
else
    echo "Using configured MQTT User: ${MQTTUSER}"
fi

if [ $MQTTPASSWORD = '<auto_detect>' ]; then
    if [ "$MQTT_SERVICE" = true ]; then
        MQTTPASSWORD=$(bashio::services mqtt "password")
        echo "Using discovered MQTT password: <hidden>"
    else
        MQTTPASSWORD=""
    fi
else
    echo "Using configured MQTT password: <hidden>"
fi

node index.js
