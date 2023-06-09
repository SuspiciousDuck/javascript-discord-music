const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, } = require("@discordjs/voice");
const youtube = require('@yimura/scraper');
const fs = require('fs');
const TOKEN = fs.readFileSync('token.txt', 'utf8');
const identity_token = fs.readFileSync('identity-token.txt', 'utf8');
const cookie_string = fs.readFileSync('cookies.txt', 'utf8')
const prefix = "!"
const ytdl = require("ytdl-core");

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

function isValidHttpUrl(string) {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

const queue = new Map(); // For queue

const HelpEmbed = new EmbedBuilder()
  .setTitle("Help Menu")
  .setDescription("These are all the available commands. Use \"!\" as the prefix")
  .addFields(
    { name: "help", value: "Displays this message" },
    { name: "ping", value: "Sends the API and bot ping" },
    { name: "play (link)", value: "Plays the attached link" },
    { name: "skip/stop", value: "Both commands skip to the next song" },
    { name: "queue", value: "Sends the current song queue" },
    { name: "clear", value: "Clears the song queue" },
    { name: "search (query)", value: "Plays the first Youtube result for the query" },
    { name: "loop", value: "Toggles loop on the current song" }
  )

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(prefix)) return;
 
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
    if (command === "ping") { // Ping command
      message.channel.send('Loading data').then(async (msg) => {
        msg.edit(`🏓Latency is ${msg.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ws.ping)}ms`);
      });
    } else if (command === 'play') {
      if (args === undefined || args.length === 0) { message.channel.send("Please include a link")
        return }
      if (!isValidHttpUrl(args[0])) {
        message.channel.send("Please include a valid link")
        return
      }
      execute(message, args, queue);
    } else if (command === 'skip') {
      skip(message, queue);
    } else if (command === 'stop') {
      stop(message, queue);
    } else if (command === 'queue') {
      showQueue(message, queue);
    } else if (command === 'clear') {
      clearQueue(message, queue);
    } else if (command === 'search') {
      if (args === undefined || args.length === 0) {
        message.channel.send("Please include a link")
        return
      }
      const searchQuery = args.join(' ');
      searchYouTube(message, searchQuery, queue);
    } else if (command === 'help') {
      message.channel.send({ embeds: [HelpEmbed] })
    } else if (command === 'loop') {
      toggleLoop(message,queue)
    } else if (command === 'pause' || command === 'resume') {
      pause(message,queue)
    }
  } catch (error) {
    message.channel.send("Command experienced an error.")
    console.log(error)
  }
});

async function execute(message, args, queue) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('You need to be in a voice channel to play music!');

  const linkPattern = /<([^<>]+)>/g;
  const spoilerPattern = /\|\|([^|]+)\|\|/g;
  const url = args[0].replace(linkPattern, '\$1').replace(spoilerPattern, '\$1');
  const songInfo = await ytdl.getInfo(url,{
    requestOptions: {
      headers: {
        cookie: cookie_string,
        'x-youtube-identity-token': identity_token,
      }
    }
  });
  const song = {
    title: songInfo.videoDetails.title,
    url: songInfo.videoDetails.video_url,
  };

  const serverQueue = queue.get(message.guild.id);

  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: [],
      playing: true,
      loop: false,
    };
    queue.set(message.guild.id, queueConstruct);
    queueConstruct.songs.push(song);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      queueConstruct.connection = connection;
      play(message.guild, queueConstruct.songs[0], queue);
    } catch (err) {
      console.log(err);
      queue.delete(message.guild.id);
      return message.channel.send(err);
    }
  } else {
    serverQueue.songs.push(song);
    return message.channel.send(`${song.title} has been added to the queue!`);
  }
}

async function play(guild, song, queue) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.connection.disconnect();
    queue.delete(guild.id);
    return;
  }

  const connection = joinVoiceChannel({
    channelId: serverQueue.voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  const stream = ytdl(song.url, {
    filter: 'audioonly',
    requestOptions: {
      headers: {
        cookie: cookie_string,
        'x-youtube-identity-token': identity_token,
      }}})

  const player = createAudioPlayer();
  const resource = createAudioResource(stream);

  player.on('error', (error) => console.error(error));
  player.on('idle', () => {
    if (serverQueue.loop) {
      // If loop is enabled, play the current song again
      play(guild, serverQueue.songs[0], queue);
    } else {
      // If loop is disabled, remove the current song and play the next one
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0], queue);
    }
  });
  
  await player.play(resource);
  connection.subscribe(player);
  serverQueue.textChannel.send(`Start playing: **${song.title}**`);
}

function skip(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to skip the music!');
  if (!serverQueue) return message.channel.send('There is no song that I could skip!');
  
  if (serverQueue.songs.length > 1) {
    serverQueue.songs.shift();
    play(message.guild, serverQueue.songs[0], queue);
  } else {
    serverQueue.connection.disconnect();
    queue.delete(message.guild.id);
  }
}

function stop(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to stop the music!');
  if (!serverQueue) return message.channel.send('There is no song playing that I could stop!');
  serverQueue.songs = [];
  serverQueue.connection.disconnect();
  queue.delete(message.guild.id);
}


function showQueue(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || serverQueue.songs.length === 0) {
    return message.channel.send('There are no songs in the queue.');
  }

  let queueList = 'Songs in the queue:\n';
  serverQueue.songs.forEach((song, index) => {
    queueList += `${index + 1}. ${song.title}\n`;
  });

  message.channel.send(queueList);
}

function clearQueue(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue || serverQueue.songs.length === 0) {
    return message.channel.send('There are no songs in the queue.');
  }

  serverQueue.songs = [];
  message.channel.send('Queue has been cleared.');
}

async function searchYouTube(message, searchQuery, queue) {
  try {
    const yt = new youtube.Scraper()
    const result = (await yt.search(searchQuery)).videos[0].link
    execute(message, [result], queue);
  } catch (err) {
    console.error('Error fetching search results:', err);
    message.channel.send("Error fetching search results")
  }
}

function toggleLoop(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!serverQueue) {
    return message.channel.send('There is nothing playing to loop.');
  }
  serverQueue.loop = !serverQueue.loop; // Toggle loop status
  return message.channel.send(`Loop is now ${serverQueue.loop ? 'enabled' : 'disabled'}.`);
}

function pause(message, queue) {
  const serverQueue = queue.get(message.guild.id);
  if (!message.member.voice.channel) return message.channel.send('You have to be in a voice channel to pause the music!');
  if (!serverQueue) return message.channel.send('There is no song playing that I could pause!');
  const connection = getVoiceConnection(message.guildId);
  if (connection.state.subscription.player.state.status === AudioPlayerStatus.Paused) {
    connection.state.subscription.player.unpause();
    message.channel.send("Resumed")
  } else {
    connection.state.subscription.player.pause();
    message.channel.send("Paused")
  }
}

client.login(TOKEN);