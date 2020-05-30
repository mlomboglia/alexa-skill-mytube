/* eslint-disable  func-names */
/* eslint-disable  no-console */
/* eslint-disable  no-restricted-syntax */
/* eslint-disable  consistent-return */

const alexa = require("ask-sdk");
const constants = require("./constants");

/* INTENT HANDLERS */

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  async handle(handlerInput) {
    console.log("LaunchRequestHandler");
    const playbackInfo = await getPlaybackInfo(handlerInput);
    let message;
    let reprompt;

    if (!playbackInfo.hasPreviousPlaybackSession) {
      message =
        "Welcome to the Mytube. ask to play a video to start listening.";
      reprompt = "You can say, play the Beatles, to begin.";
    } else {
      playbackInfo.inPlaybackSession = false;
      if (playbackInfo.index < 0) {
        playbackInfo.index = 0;
      }
      message = `You were listening to ${
        playbackInfo.playOrder[playbackInfo.index].snippet.title
      }. Would you like to resume?`;
      reprompt = "You can say yes to resume or no to play from the top.";
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(reprompt)
      .getResponse();
  },
};

const AudioPlayerEventHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type.startsWith("AudioPlayer.");
  },
  async handle(handlerInput) {
    const {
      requestEnvelope,
      attributesManager,
      responseBuilder,
    } = handlerInput;
    const audioPlayerEventName = requestEnvelope.request.type.split(".")[1];
    const {
      playbackSetting,
      playbackInfo,
    } = await attributesManager.getPersistentAttributes();
    console.log("AudioPlayerEventHandler");
    console.log(audioPlayerEventName);
    switch (audioPlayerEventName) {
      case "PlaybackStarted":
        playbackInfo.token = getToken(handlerInput);
        playbackInfo.index = await getIndex(handlerInput);
        playbackInfo.inPlaybackSession = true;
        playbackInfo.hasPreviousPlaybackSession = true;
        break;
      case "PlaybackFinished":
        playbackInfo.inPlaybackSession = false;
        playbackInfo.hasPreviousPlaybackSession = false;
        playbackInfo.nextStreamEnqueued = false;
        break;
      case "PlaybackStopped":
        playbackInfo.token = getToken(handlerInput);
        playbackInfo.index = await getIndex(handlerInput);
        console.log(playbackInfo.index);
        playbackInfo.offsetInMilliseconds = getOffsetInMilliseconds(
          handlerInput
        );
        break;
      case "PlaybackNearlyFinished": {
        if (playbackInfo.nextStreamEnqueued) {
          break;
        }

        const enqueueIndex = playbackInfo.index + 1;

        if (enqueueIndex === 0 && !playbackSetting.loop) {
          break;
        }

        playbackInfo.nextStreamEnqueued = true;
        const playBehavior = "ENQUEUE";

        const audio = playbackInfo.playOrder[enqueueIndex];
        if (audio === undefined) {
          playbackInfo.nextStreamEnqueued = false;
          console.log("End of Playlist");
          return;
        } else {
          const enqueueToken = audio.videoId;
          const url = await getRemoteData(
            `${constants.skill.audioServer}/play/${audio.videoId}`
          )
            .then((response) => {
              const data = JSON.parse(response);
              console.log(data);
              return data.url;
            })
            .catch((err) => {
              console.log(err);
              return err;
            });
          const expectedPreviousToken = playbackInfo.token;
          const offsetInMilliseconds = 0;

          responseBuilder.addAudioPlayerPlayDirective(
            playBehavior,
            url,
            enqueueToken,
            offsetInMilliseconds,
            expectedPreviousToken
          );
          break;
        }
      }
      case "PlaybackFailed":
        playbackInfo.inPlaybackSession = false;
        console.log(
          "Playback Failed : %j",
          handlerInput.requestEnvelope.request.error
        );
        return;
      default:
        throw new Error("Should never reach here!");
    }

    return responseBuilder.getResponse();
  },
};

const CheckAudioInterfaceHandler = {
  async canHandle(handlerInput) {
    const audioPlayerInterface = (
      (((handlerInput.requestEnvelope.context || {}).System || {}).device || {})
        .supportedInterfaces || {}
    ).AudioPlayer;
    return audioPlayerInterface === undefined;
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("Sorry, this skill is not supported on this device")
      .withShouldEndSession(true)
      .getResponse();
  },
};

const StartPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    if (!playbackInfo.inPlaybackSession) {
      return (
        request.type === "IntentRequest" &&
        request.intent.name === "GetVideoIntent"
      );
    }
    if (request.type === "PlaybackController.PlayCommandIssued") {
      return true;
    }

    if (request.type === "IntentRequest") {
      return request.intent.name === "GetVideoIntent";
    }
  },
  handle(handlerInput) {
    console.log("StartPlaybackHandler");
    const speechText =
      handlerInput.requestEnvelope.request.intent.slots.videoQuery.value;

    return controller.search(handlerInput, speechText, null);
  },
};

const NextPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      (request.type === "PlaybackController.NextCommandIssued" ||
        (request.type === "IntentRequest" &&
          request.intent.name === "AMAZON.NextIntent"))
    );
  },
  handle(handlerInput) {
    console.log("NextPlaybackHandler");
    return controller.playNext(handlerInput);
  },
};

const PreviousPlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      (request.type === "PlaybackController.PreviousCommandIssued" ||
        (request.type === "IntentRequest" &&
          request.intent.name === "AMAZON.PreviousIntent"))
    );
  },
  handle(handlerInput) {
    console.log("PreviousPlaybackHandler");
    return controller.playPrevious(handlerInput);
  },
};

const PausePlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.StopIntent" ||
        request.intent.name === "AMAZON.CancelIntent" ||
        request.intent.name === "AMAZON.PauseIntent")
    );
  },
  handle(handlerInput) {
    console.log("PausePlaybackHandler");
    return controller.stop(handlerInput, "Pausing ");
  },
};

const ResumePlaybackHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.PlayIntent" ||
        request.intent.name === "AMAZON.ResumeIntent")
    );
  },
  handle(handlerInput) {
    console.log("ResumePlaybackHandler");
    return controller.play(handlerInput, "Resuming ");
  },
};

const LoopOnHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.LoopOnIntent"
    );
  },
  async handle(handlerInput) {
    console.log("LoopOnHandler");
    const playbackSetting = await handlerInput.attributesManager.getPersistentAttributes()
      .playbackSetting;

    playbackSetting.loop = true;

    return handlerInput.responseBuilder.speak("Loop turned on.").getResponse();
  },
};

const LoopOffHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.LoopOffIntent"
    );
  },
  async handle(handlerInput) {
    console.log("LoopOffHandler");
    const playbackSetting = await handlerInput.attributesManager.getPersistentAttributes()
      .playbackSetting;

    playbackSetting.loop = false;

    return handlerInput.responseBuilder.speak("Loop turned off.").getResponse();
  },
};

const ShuffleOnHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.ShuffleOnIntent"
    );
  },
  async handle(handlerInput) {
    console.log("ShuffleOnHandler");
    const {
      playbackInfo,
      playbackSetting,
    } = await handlerInput.attributesManager.getPersistentAttributes();

    playbackSetting.shuffle = true;
    playbackInfo.playOrder = await shuffleOrder();
    playbackInfo.index = 0;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;
    return controller.play(handlerInput, "Shuffle on, Playing ");
  },
};

const ShuffleOffHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.ShuffleOffIntent"
    );
  },
  async handle(handlerInput) {
    console.log("ShuffleOffHandler");
    const {
      playbackInfo,
      playbackSetting,
    } = await handlerInput.attributesManager.getPersistentAttributes();

    //if (playbackSetting.shuffle) {
    //  playbackSetting.shuffle = false;
    //  playbackInfo.index = playbackInfo.playOrder[playbackInfo.index];
    //  playbackInfo.playOrder = [...Array(playbackInfo.playOrder).keys()];
    //}

    return controller.play(handlerInput, "Shuffle off, Playing ");
  },
};

const StartOverHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.StartOverIntent"
    );
  },
  async handle(handlerInput) {
    console.log("StartOverHandler");
    const playbackInfo = await getPlaybackInfo(handlerInput);

    playbackInfo.offsetInMilliseconds = 0;

    return controller.play(handlerInput, "Starting Over ");
  },
};

const YesHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.YesIntent"
    );
  },
  handle(handlerInput) {
    console.log("YesHandler");
    return controller.play(handlerInput, "Resuming ");
  },
};

const NoHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      request.intent.name === "AMAZON.NoIntent"
    );
  },
  async handle(handlerInput) {
    console.log("NoHandler");
    const playbackInfo = await getPlaybackInfo(handlerInput);

    playbackInfo.index = 0;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;
    playbackInfo.hasPreviousPlaybackSession = false;

    return controller.play(handlerInput, "Playing ");
  },
};

const HelpHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "AMAZON.HelpIntent"
    );
  },
  async handle(handlerInput) {
    console.log("HelpHandler");
    const playbackInfo = await getPlaybackInfo(handlerInput);
    let message;

    if (!playbackInfo.hasPreviousPlaybackSession) {
      message = "Welcome to the Mytube. You can say, play video to begin.";
    } else if (!playbackInfo.inPlaybackSession) {
      message = `You were listening to ${
        constants.audioData[playbackInfo.index].snippet.title
      }. Would you like to resume?`;
    } else {
      message =
        "You are listening to Mytube. You can say, Next or Previous to navigate through the playlist. At any time, you can say Pause to pause the audio and Resume to resume.";
    }

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  },
};

const ExitHandler = {
  async canHandle(handlerInput) {
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const request = handlerInput.requestEnvelope.request;

    return (
      !playbackInfo.inPlaybackSession &&
      request.type === "IntentRequest" &&
      (request.intent.name === "AMAZON.StopIntent" ||
        request.intent.name === "AMAZON.CancelIntent")
    );
  },
  handle(handlerInput) {
    console.log("ExitHandler");
    return handlerInput.responseBuilder.speak("Goodbye!").getResponse();
  },
};

const SystemExceptionHandler = {
  canHandle(handlerInput) {
    return (
      handlerInput.requestEnvelope.request.type ===
      "System.ExceptionEncountered"
    );
  },
  handle(handlerInput) {
    console.log("SystemExceptionHandler");
    console.log(JSON.stringify(handlerInput.requestEnvelope, null, 2));
    console.log(
      `System exception encountered: ${handlerInput.requestEnvelope.request.reason}`
    );
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput) {
    console.log("SessionEndedRequestHandler");
    console.log(
      `Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`
    );

    return handlerInput.responseBuilder.getResponse();
  },
};
const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log("ErrorHandler");
    console.log(error);
    console.log(`Error handled: ${error.message}`);
    const message =
      "Sorry, this is not a valid command. Please say help to hear what you can say.";

    return handlerInput.responseBuilder
      .speak(message)
      .reprompt(message)
      .getResponse();
  },
};

/* INTERCEPTORS */

const LoadPersistentAttributesRequestInterceptor = {
  async process(handlerInput) {
    const persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes();

    // Check if user is invoking the skill the first time and initialize preset values
    if (Object.keys(persistentAttributes).length === 0) {
      handlerInput.attributesManager.setPersistentAttributes({
        playbackSetting: {
          loop: false,
          shuffle: false,
        },
        playbackInfo: {
          playOrder: [],
          index: 0,
          offsetInMilliseconds: 0,
          playbackIndexChanged: true,
          token: "",
          nextStreamEnqueued: false,
          inPlaybackSession: false,
          hasPreviousPlaybackSession: false,
          query: "",
          nextPageToken: "",
        },
      });
    }
  },
};

const SavePersistentAttributesResponseInterceptor = {
  async process(handlerInput) {
    await handlerInput.attributesManager.savePersistentAttributes();
  },
};

/* HELPER FUNCTIONS */

async function getPlaybackInfo(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();
  return attributes.playbackInfo;
}

async function canThrowCard(handlerInput) {
  const { requestEnvelope, attributesManager } = handlerInput;
  const playbackInfo = await getPlaybackInfo(handlerInput);

  if (
    requestEnvelope.request.type === "IntentRequest" &&
    playbackInfo.playbackIndexChanged
  ) {
    playbackInfo.playbackIndexChanged = false;
    return true;
  }
  return false;
}

const controller = {
  async search(handlerInput, query, nextPageToken) {
    const {
      playbackInfo,
    } = await handlerInput.attributesManager.getPersistentAttributes();
    let searchUrl = "";
    if (nextPageToken != null) {
      searchUrl = `${constants.skill.audioServer}/search/${query}/${nextPageToken}`;
    } else {
      searchUrl = `${constants.skill.audioServer}/search/${query}`;
    }
    console.log(searchUrl);
    const data = await getRemoteData(searchUrl)
      .then((response) => {
        return JSON.parse(response);
        //return data.results;
      })
      .catch((err) => {
        console.log(err);
        throw err;
      });
    console.log(data);
    playbackInfo.playOrder = data.results;
    playbackInfo.index = 0;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;
    playbackInfo.query = query;
    playbackInfo.nextPageToken = data.nextPageToken;
    return this.play(handlerInput, "Playing ");
  },
  async play(handlerInput, message) {
    const { attributesManager, responseBuilder } = handlerInput;

    const playbackInfo = await getPlaybackInfo(handlerInput);
    const { playOrder, offsetInMilliseconds, index } = playbackInfo;
    const playBehavior = "REPLACE_ALL";
    const audio = playOrder[index];
    if (audio === undefined) {
      return controller.search(
        handlerInput,
        playbackInfo.query,
        playbackInfo.nextPageToken
      );
    }
    const url = await getRemoteData(
      `${constants.skill.audioServer}/play/${audio.videoId}`
    )
      .then((response) => {
        const data = JSON.parse(response);
        console.log(data);
        return data.url;
      })
      .catch((err) => {
        console.log(err);
        return err;
      });
    console.log(url);
    const token = audio.videoId;
    playbackInfo.nextStreamEnqueued = false;

    responseBuilder
      .speak(`${message} ${audio.snippet.title}`)
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(
        playBehavior,
        url,
        token,
        offsetInMilliseconds,
        null
      );

    if (await canThrowCard(handlerInput)) {
      const cardTitle = `Playing ${audio.snippet.title}`;
      const cardContent = `Playing ${audio.snippet.title}`;
      responseBuilder.withSimpleCard(cardTitle, cardContent);
    }

    return responseBuilder.getResponse();
  },
  stop(handlerInput, message) {
    return handlerInput.responseBuilder
      .speak(message)
      .addAudioPlayerStopDirective()
      .getResponse();
  },
  async playNext(handlerInput) {
    const {
      playbackInfo,
      playbackSetting,
    } = await handlerInput.attributesManager.getPersistentAttributes();
    console.log("PlayNext");
    const nextIndex = playbackInfo.index + 1;

    if (nextIndex === 0 && !playbackSetting.loop) {
      return this.search(handlerInput, playbackInfo.query, playbackInfo.nextPageToken);
    }

    playbackInfo.index = nextIndex;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput, "Playing Next ");
  },
  async playPrevious(handlerInput) {
    const {
      playbackInfo,
      playbackSetting,
    } = await handlerInput.attributesManager.getPersistentAttributes();

    let previousIndex = playbackInfo.index - 1;

    if (previousIndex === -1) {
      if (playbackSetting.loop) {
        previousIndex += playbackInfo.playOrder.length;
      } else {
        return handlerInput.responseBuilder
          .speak("You have reached the start of the playlist")
          .addAudioPlayerStopDirective()
          .getResponse();
      }
    }

    playbackInfo.index = previousIndex;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput, "Playing Previous ");
  },
};

function getToken(handlerInput) {
  // Extracting token received in the request.
  return handlerInput.requestEnvelope.request.token;
}

async function getIndex(handlerInput) {
  // Extracting index from the token received in the request.
  const tokenValue = handlerInput.requestEnvelope.request.token;
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();
  const index = attributes.playbackInfo.playOrder
    .map((e) => e.videoId)
    .indexOf(tokenValue);
  console.log(index);
  return index;
}

function getOffsetInMilliseconds(handlerInput) {
  // Extracting offsetInMilliseconds received in the request.
  return handlerInput.requestEnvelope.request.offsetInMilliseconds;
}

function shuffleOrder() {
  const array = [...Array(playbackInfo.playOrder.length).keys()];
  let currentIndex = array.length;
  let temp;
  let randomIndex;
  // Algorithm : Fisher-Yates shuffle
  return new Promise((resolve) => {
    while (currentIndex >= 1) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temp = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temp;
    }
    resolve(array);
  });
}

const getRemoteData = function (url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? require("https") : require("http");
    const request = client.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        reject(new Error("Failed with status code: " + response.statusCode));
      }
      const body = [];
      response.on("data", (chunk) => body.push(chunk));
      response.on("end", () => resolve(body.join("")));
    });
    request.on("error", (err) => reject(err));
  });
};

const skillBuilder = alexa.SkillBuilders.standard();
exports.handler = skillBuilder
  .addRequestHandlers(
    CheckAudioInterfaceHandler,
    LaunchRequestHandler,
    HelpHandler,
    SystemExceptionHandler,
    SessionEndedRequestHandler,
    YesHandler,
    NoHandler,
    StartPlaybackHandler,
    NextPlaybackHandler,
    PreviousPlaybackHandler,
    PausePlaybackHandler,
    ResumePlaybackHandler,
    LoopOnHandler,
    LoopOffHandler,
    ShuffleOnHandler,
    ShuffleOffHandler,
    StartOverHandler,
    ExitHandler,
    AudioPlayerEventHandler
  )
  .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
  .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
  .addErrorHandlers(ErrorHandler)
  .withAutoCreateTable(true)
  .withTableName(constants.skill.dynamoDBTableName)
  .lambda();
