const PLUGIN_ID = 'signalk-barometric-storm-alarm'
const PLUGIN_NAME = 'Barometric Storm Alarm'

const basePath = 'environment.outside.stormAlarm'
const predictionPath = `${basePath}.prediction`
const notificationPath = `notifications.${predictionPath}`

module.exports = function(app) {
  var plugin = {}
  var alertOptions
  var unsubscribes = []

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = "Generate an alarm when the barometric pressure drops 4 hPa (0.12 inHg) or more during a 3-hour period."

  plugin.schema = function() {
    var schema = {
      type: "object",
      title: "Barometer Storm Alarm",
      properties: {
        enabled: {
          title: 'Enabled',
          type: 'boolean',
          default: true
        },
        refreshRate: {
          type: 'number',
          title: 'Refresh Rate in minutes',
          default: 5
        }
      }
    };

    return schema;
  }

  plugin.start = function(options) {
    alertOptions = options

    if (alertOptions.enabled) {
      //subscribe to barometer updates
      let localSubscription = {
        context: 'vessels.self', // Get data for all contexts
        subscribe: [{
          path: 'environment.outside.pressure',
          period: alertOptions.refreshRate * 60000
        }]
      };

      app.subscriptionmanager.subscribe(
        localSubscription,
        unsubscribes,
        subscriptionError => {
          app.error('Error:' + subscriptionError)
        },
        delta => {
          delta.updates.forEach(update => {
            checkBarometer(update)
          });
        }
      );
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f())
    unsubscribes = []
  }

  function handleDelta(values) {
    if (values.length == 0) {
      return
    }

    let delta = {
      "updates": [{
        "values": values
      }]
    }
    app.debug(JSON.stringify(delta))

    app.handleMessage(PLUGIN_ID, delta)
  }

  function findPaths(obj, propName, value, prefix = '', store = []) {
    for (let key in obj) {
      const curPath = prefix.length > 0 ? `${prefix}.${key}` : key
      if (typeof obj[key] === 'object') {
        if (!propName || curPath.includes(propName)) {
          store.push(curPath)
        }
        findPaths(obj[key], propName, value, curPath, store);
      } else {
        if ((!propName || curPath.includes(propName)) &&
          (!value || obj[key] == value)) {
          store.push(curPath)
        }
      }
    }
    return store
  }

  function checkBarometer(update) {
    let current = update.values[0].value / 100

    //get the value for 3 hours ago
    let d = new Date()
    d.setHours(d.getHours() - 3)

    //const realPath = app.selfId
    const realPath = '/vessels/self/environment/outside/pressure'
    app.historyProvider.getHistory(
      d.toISOString(),
      realPath,
      deltas => {
        if (deltas.length === 0) {
          app.error('No history was found.')
          return
        }
        const last = app.deltaCache.buildFullFromDeltas(
          req.skPrincipal,
          deltas
        )

        //find pressure in last
        let past = last.environment.outside.pressure.value * .01
        app.debug('Outside pressure from 3 hours ago: ' + past)

        let prediction = analyzeBarometerDiff(current, past)

        //send predictionPath deltas
        let values = createPredictionDelta(prediction)
        handleDelta(values)

        if (prediction.alert == 'none') {
          //look for existing notification delta and clear it
          removeOldAlert()
        } else {
          //send notification delta
          let notification = createNotification(prediction)
          handleDelta(notification)
        }
      }
    )
  }

  function analyzeBarometerDiff(current, past) {
    let diff = past - current
    app.debug('Barometer 3 hour change: ' + diff)

    let prediction = {
      prediction: 'Unknown',
      alert: 'none',
      pastValue: past,
      currentValue: current,
      difference: diff
    }

    if (current < 1009) {
      app.debug('Case1')
      switch (true) {
        case (diff >= 0):
          prediction.prediction = 'Clearing and Colder'
          prediction.alert = 'none'
          break
        case (diff < 0 && diff > -4):
          prediction.prediction = 'Rain and Wind'
          preidction.alert = 'alert'
          break
        case (diff <= -4 && diff > -10):
          prediction.prediction = 'Storm'
          prediction.alert = 'alarm'
          break
        case (diff <= -10):
          prediction.prediction = 'Storm and Gale'
          prediction.alert = 'alarm'
          break
        default:
          prediction.prediction = 'Unknown'
          prediction.alert = 'none'
      }
    } else if (current >= 1009 && current < 1019) {
      app.debug('Case2')
      switch (true) {
        case (current > 1015 && (diff >= 1.1 && diff <= 2.7)):
          prediction.prediction = 'Poorer weather to come'
          prediction.alert = 'alert'
          break
        case (diff <= -4):
          prediction.prediction = 'Rain and Wind'
          prediction.alert = 'alert'
          break
        default:
          prediction.prediction = 'No change'
          prediction.alert = 'none'
      }
    } else if (current >= 1019 && current < 1023) {
      app.debug('Case3')
      switch (true) {
        case (diff > 2.7):
          prediction.prediction = 'No change'
          prediction.alert = 'none'
          break
        case (diff >= 1.1 && diff <= 2.7):
          prediction.prediction = 'Poorer weather to come'
          prediction.alert = 'alert'
          break
        case (diff < 1.1 && diff > -1.1):
          prediction.prediction = 'Fair with slight temperature change'
          prediction.alert = 'none'
          break
        case (diff <= -1.1 && diff > -4):
          prediction.prediction = 'No change and rain within 24 hours'
          prediction.alert = 'none'
          break
        case (diff <= -4):
          prediction.prediction = 'Rain & may also get increasing wind speed and temperature'
          prediction.alert = 'alert'
          break
      }
    } else if (current >= 1023) {
      app.debug('Case4')
      switch (true) {
        case (diff > 2.7):
          prediction.prediction = 'Fair weather'
          prediction.alert = 'none'
          break
        case (diff >= 1.1 && diff <= 2.7):
          prediction.prediction = 'Poorer weather to come'
          prediction.alert = 'alert'
          break
        case (diff < 1.1 && diff > -1.1):
          prediction.prediction = 'Fair with no marked temperature change'
          prediction.alert = 'none'
          break
        case (diff <= -1.1 && diff > -4):
          prediction.prediction = 'Fair and slowly rising temperature'
          prediction.alert = 'none'
          break
        case (diff <= -4):
          prediction.prediction = 'Warming trend'
          prediction.alert = 'none'
          break
      }
    }

    return prediction
  }

  function createPredictionDelta(prediction) {
    return {
      "updates": [{
        "values": [{
          "path": predictionPath,
          "value": prediction.prediction
        }]
      }]
    }
  }

  function createNotification(prediction) {
    let values = []
    let value = {
      "state": prediction.alert,
      "method": [
        "visual",
        "sound"
      ]
    }

    value.pastValue = prediction.past
    value.currentValue = prediction.current
    value.difference = preidction.diff

    values.push({
      "path": path,
      "value": notificationPath
    });
  }

  function removeOldAlert() {
    let existing = app.getSelfPath(notificationPath)
    app.debug('existing: ' + JSON.stringify(existing))

    if (existing) {
      let values = []

      values.push({
        "path": notificationPath,
        "value": null
      });

      handleDelta(values)
    }
  }

  return plugin
}
