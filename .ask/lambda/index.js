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
      .speak(alexa.escapeXmlCharacters(message))
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
    const { playbackInfo } = await attributesManager.getPersistentAttributes();
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
        const audio = playbackInfo.playOrder[playbackInfo.index];
        if (audio === undefined) {
          playbackInfo.nextStreamEnqueued = false;
          console.log("End of Playlist");
          return controller.search(
            handlerInput,
            playbackInfo.query,
            playbackInfo.nextPageToken
          );
        } else {
          const { url, token } = await getNextAudioUrl(playbackInfo);
          const expectedPreviousToken = playbackInfo.token;
          const offsetInMilliseconds = 0;
          const playBehavior = "ENQUEUE";
          playbackInfo.nextStreamEnqueued = true;

          responseBuilder.addAudioPlayerPlayDirective(
            playBehavior,
            url,
            token,
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
    return controller.play(handlerInput, "Resuming: ");
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

    return controller.play(handlerInput, "Starting Over: ");
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
    return controller.play(handlerInput, "Resuming: ");
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

    return controller.play(handlerInput, "Playing: ");
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
      .speak(alexa.escapeXmlCharacters(message))
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
    console.log(JSON.stringify(handlerInput.requestEnvelope, null, 2));
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
      .speak(alexa.escapeXmlCharacters(message))
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
      searchUrl = `${constants.config.audioServer}/search/${query}/${nextPageToken}`;
    } else {
      searchUrl = `${constants.config.audioServer}/search/${query}`;
    }
    console.log(searchUrl);
    const data = await getRemoteData(searchUrl)
      .then((response) => {
        return JSON.parse(response);
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
    return this.play(handlerInput, "Playing: ");
  },
  async play(handlerInput, message) {
    const { attributesManager, responseBuilder } = handlerInput;
    const playbackInfo = await getPlaybackInfo(handlerInput);
    const { playOrder, offsetInMilliseconds, index } = playbackInfo;
    let audio = playOrder[index];
    if (audio === undefined) {
      return controller.search(
        handlerInput,
        playbackInfo.query,
        playbackInfo.nextPageToken
      );
    }
    const playBehavior = "REPLACE_ALL";
    const { url, title, token } = await getAudioUrl(audio);
    playbackInfo.nextStreamEnqueued = false;
    responseBuilder
      .speak(alexa.escapeXmlCharacters(`${message} ${title}`))
      .withShouldEndSession(true)
      .addAudioPlayerPlayDirective(
        playBehavior,
        url,
        token,
        offsetInMilliseconds,
        null
      );

    if (await canThrowCard(handlerInput)) {
      const cardTitle = `Playing ${title}`;
      const cardContent = `Playing ${title}`;
      responseBuilder.withSimpleCard(cardTitle, cardContent);
    }

    return responseBuilder.getResponse();
  },
  stop(handlerInput, message) {
    return handlerInput.responseBuilder
      .speak(alexa.escapeXmlCharacters(message))
      .addAudioPlayerStopDirective()
      .getResponse();
  },
  async playNext(handlerInput) {
    const {
      playbackInfo,
    } = await handlerInput.attributesManager.getPersistentAttributes();
    console.log("PlayNext");
    let audio = playbackInfo.playOrder[playbackInfo.index];
    if (audio.id.kind === constants.kind.KIND_PLAYLIST) {
      const nextPlayListIndex = audio.playListIndex + 1;
      audio.playListIndex = nextPlayListIndex;
      if (audio.playlistItems[nextPlayListIndex].videoId == undefined) {
        playbackInfo.index = playbackInfo.index + 1;
      } else {
        audio.videoId = audio.playlistItems[nextPlayListIndex].videoId;
      }
    } else {
      const nextIndex = playbackInfo.index + 1;
      if (nextIndex === 0) {
        return this.search(
          handlerInput,
          playbackInfo.query,
          playbackInfo.nextPageToken
        );
      }
      playbackInfo.index = nextIndex;
    }
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput, "Playing Next: ");
  },
  async playPrevious(handlerInput) {
    const {
      playbackInfo,
    } = await handlerInput.attributesManager.getPersistentAttributes();

    let previousIndex = playbackInfo.index - 1;

    if (previousIndex === -1) {
      return handlerInput.responseBuilder
        .speak("You have reached the start of the playlist")
        .addAudioPlayerStopDirective()
        .getResponse();
    }

    playbackInfo.index = previousIndex;
    playbackInfo.offsetInMilliseconds = 0;
    playbackInfo.playbackIndexChanged = true;

    return this.play(handlerInput, "Playing Previous: ");
  },
};



const getAudioUrl = async (audio) => {
  let title = "";
  if (audio.id.kind === constants.kind.KIND_PLAYLIST) {
    //Playlist
    //Check for list of audio files
    if (audio.videoId === undefined) {
      const playlistItems = await getRemoteData(
        `${constants.config.audioServer}/playlist/${audio.playlistId}`
      )
        .then((response) => {
          const data = JSON.parse(response);
          return data.results;
        })
        .catch((err) => {
          console.log(err);
          return err;
        });
      audio.playlistItems = playlistItems;
      audio.playListIndex = 0;
      audio.videoId = playlistItems[0].videoId;
    }
    title = audio.playlistItems[audio.playListIndex].snippet.title;
  } else {
    title = audio.snippet.title;
  }
  const token = audio.videoId;
  const url = await getRemoteData(
    `${constants.config.audioServer}/play/${audio.videoId}`
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
  return { url, title, token };
};

const getNextAudioUrl = async (playbackInfo) => {
  let audio = playbackInfo.playOrder[playbackInfo.index];
  let index = 0;
  //Check if playlist
  if (audio.id.kind === constants.kind.KIND_PLAYLIST) {
    const nextPlayListIndex = audio.playListIndex + 1;
    //audio.playListIndex = nextPlayListIndex;
    if (audio.playlistItems[nextPlayListIndex].videoId == undefined) {
      //Playlist finished, go to next audio in the list
      index = playbackInfo.index + 1
      //playbackInfo.index = playbackInfo.index + 1;
      audio = audio.playOrder[index];
    } else {
      //Next audio in the playlist
      audio = audio.playlistItems[nextPlayListIndex];
    }
  } else {
    //Not playlist, go to next audio in the list
    index = playbackInfo.index + 1
    audio = audio.playOrder[index];
  } 
  return getAudioUrl(audio);
};

function getToken(handlerInput) {
  // Extracting token received in the request.
  return handlerInput.requestEnvelope.request.token;
}

async function getIndex(handlerInput) {
  const attributes = await handlerInput.attributesManager.getPersistentAttributes();
  return attributes.playbackInfo.index;
}

function getOffsetInMilliseconds(handlerInput) {
  // Extracting offsetInMilliseconds received in the request.
  return handlerInput.requestEnvelope.request.offsetInMilliseconds;
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
    StartOverHandler,
    ExitHandler,
    AudioPlayerEventHandler
  )
  .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
  .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
  .addErrorHandlers(ErrorHandler)
  .withAutoCreateTable(true)
  .withTableName(constants.config.dynamoDBTableName)
  .lambda();
