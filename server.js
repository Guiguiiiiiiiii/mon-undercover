const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ============================================================
// 🔽 LISTES DE MOTS (ANIME) 🔽
// ============================================================
const listesDeMots = {
    "Naruto": [
        "Naruto Uzumaki", "Sasuke Uchiha", "Sakura Haruno", "Kakashi Hatake", "Hinata Hyuga", "Neji Hyuga", "Rock Lee", "Tenten", "Gaara", "Kankuro", "Temari", "Shikamaru Nara", "Choji Akimichi", "Ino Yamanaka", "Sai", "Yamato", "Jiraiya", "Tsunade", "Orochimaru", "Itachi Uchiha", "Kisame Hoshigaki", "Deidara", "Sasori", "Hidan","Kakuzu", "Pain", "Konan", "Nagato", "Obito Uchiha", "Madara Uchiha", "Minato Namikaze", "Kushina Uzumaki", "Tobirama Senju", "Hashirama Senju", "Hiruzen Sarutobi", "Danzo Shimura", "Killer Bee", "Kiba Inuzuka", "Akamaru", "Shino Aburame", "Might Guy", "Iruka Umino", "Konohamaru Sarutobi", "Hanabi Hyuga", "Karin", "Suigetsu Hozuki", "Jugo", "Kabuto Yakushi","Kaguya", "Hanzo", "Zabuza", "Haku"
    ],
    "AoT": [
        "Eren Yeager", "Mikasa Ackerman", "Armin Arlert", "Levi Ackerman", "Erwin Smith", "Hange Zoë", "Jean Kirstein", "Connie Springer", "Sasha Blouse", "Historia Reiss", "Ymir", "Reiner Braun", "Bertholdt Fubar", "Annie Leonhart", "Zeke Yeager", "Pieck Finger", "Porco Galliard", "Falco Grice", "Gabi Braun", "Dot Pixis", "Keith Shadis", "Floch Forster","Kenny Ackerman"
    ],
    "Demon Slayer": [
        "Tanjiro", "Zenitsu", "Inosuke", "Kagaya", "Tomioka – Pilier de l’Eau", "Shinobu – Pilier de l’Insecte", "Kyojuro – Pilier de la Flamme", "Tengen – Pilier du Son", "Muichiro – Pilier de la Brume", "Mitsuri – Pilier de l’Amour", "Sanemi – Pilier du Vent", "Obanai – Pilier du Serpent", "Gyomei – Pilier de la Roche", "Urokodaki – Ancien Pilier de l’Eau", "Kanae – Ancien Pilier de la Fleur", "Sabito", "Kanao", "Genya", "Hotaru – Forgeron des Slayers", "Pourfendeur de Démons", "Jigoro", "Yoriichi", "Shinjurô", "Muzan – Empereur des Démons", "Kokushibo – Lune Supérieure 1", "Doma – Lune Supérieure 2", "Akaza – Lune Supérieure 3", "Hantengu – Lune Supérieure 4", "Nakime – Lune Supérieure 4 (Remplaçante)", "Gyokko – Lune Supérieure 5", "Daki", "Gyutaro – Lunes Supérieures 6", "Kaigaku", "Enmu – Lune Inférieure 1", "Rui – Lune Inférieure 2", "Susamaru", "Yahaba", "Kumo", "Hairo", "Furûto", "Nezuko", "Yushiro", "Tamayo"
    ],
    "Difficile": [
        "Amour", "Amitié", "Haine", "Jalousie",
        "Philosophie", "Psychologie", "Mathématiques",
        "Histoire", "Géographie", "Physique"
    ]
};

let rooms = {}; 
let joueurs = {}; 

io.on('connection', (socket) => {
  
  socket.emit('update_room_list', getPublicRooms());

  socket.on('creer_room', (infos) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
        code: roomCode, hostId: socket.id, joueurs: [], status: 'waiting', lastAction: Date.now(), 
        settings: { category: "Naruto", hasUndercover: true, hasWhite: true, whiteCanStart: false, timeWord: 20, timeVote: 15 },
        gameData: {}
    };
    rejoindreLaSalle(socket, infos.pseudo, roomCode);
  });

  socket.on('rejoindre_room', (infos) => {
    if (rooms[infos.code]) rejoindreLaSalle(socket, infos.pseudo, infos.code);
    else socket.emit('erreur', "Cette salle n'existe pas.");
  });

  socket.on('quitter_room', () => gererDepart(socket));

  socket.on('update_settings', (newSettings) => {
    const j = joueurs[socket.id];
    if (!j || !rooms[j.room]) return;
    const room = rooms[j.room];
    room.lastAction = Date.now(); 

    if (!newSettings.hasUndercover && !newSettings.hasWhite) newSettings.hasUndercover = true; 
    if (!listesDeMots[newSettings.category]) newSettings.category = "Naruto";

    if (room.hostId === socket.id) {
        room.settings = { ...room.settings, ...newSettings };
        io.to(j.room).emit('update_settings_view', room.settings);
    }
  });

  socket.on('lancer_partie', () => {
    const j = joueurs[socket.id];
    const room = rooms[j.room];
    if (!j || !room || room.hostId !== socket.id) return;
    if (room.joueurs.length < 3) { socket.emit('erreur', "Il faut au moins 3 joueurs !"); return; }

    room.lastAction = Date.now();
    room.status = 'playing';
    room.gameData = { indexJoueurActuel: 0, votes: {}, phase: 'tour', timer: null };

    const cat = room.settings.category;
    const listeChoisie = listesDeMots[cat] || listesDeMots["Naruto"];
    let idx1 = Math.floor(Math.random() * listeChoisie.length);
    let idx2 = Math.floor(Math.random() * listeChoisie.length);
    while (idx1 === idx2) idx2 = Math.floor(Math.random() * listeChoisie.length);
    
    const motCivil = listeChoisie[idx1];
    const motUndercover = listeChoisie[idx2];
    room.gameData.motCivil = motCivil;

    room.joueurs.forEach(p => { p.role = 'Civil'; p.motSecret = motCivil; p.vivant = true; p.motEcrit = ""; });

    let availableIndexes = [...Array(room.joueurs.length).keys()];
    availableIndexes.sort(() => Math.random() - 0.5);

    if (room.settings.hasUndercover) {
        const idx = availableIndexes.shift();
        room.joueurs[idx].role = 'Undercover';
        room.joueurs[idx].motSecret = motUndercover;
    }
    if (room.settings.hasWhite && availableIndexes.length > 0) {
        const idx = availableIndexes.shift();
        room.joueurs[idx].role = 'Mr. White';
        room.joueurs[idx].motSecret = null;
    }

    room.joueurs.sort(() => Math.random() - 0.5);

    if (room.settings.hasWhite && !room.settings.whiteCanStart) {
        while (room.joueurs[0].role === 'Mr. White') {
            const targetIndex = Math.floor(Math.random() * (room.joueurs.length - 1)) + 1;
            [room.joueurs[0], room.joueurs[targetIndex]] = [room.joueurs[targetIndex], room.joueurs[0]];
        }
    }

    room.joueurs.forEach(p => { io.to(p.id).emit('debut_jeu', { mot: p.motSecret, role: p.role }); });
    io.emit('update_room_list', getPublicRooms());
    lancerTour(room);
  });

  socket.on('envoyer_mot_tour', (mot) => {
    const j = joueurs[socket.id];
    const room = rooms[j.room];
    if (!room || room.gameData.phase !== 'tour') return;
    room.lastAction = Date.now();
    const currentP = room.joueurs[room.gameData.indexJoueurActuel];
    if (currentP.id === socket.id) {
        clearInterval(room.gameData.timer);
        currentP.motEcrit = mot;
        room.gameData.indexJoueurActuel++;
        checkFinTour(room);
    }
  });

  socket.on('vote_contre', (idCible) => {
    const j = joueurs[socket.id];
    const room = rooms[j.room];
    if(!room || room.gameData.phase !== 'vote') return;
    room.lastAction = Date.now();
    room.gameData.votes[socket.id] = idCible;
    const vivants = room.joueurs.filter(p => p.vivant);
    if (Object.keys(room.gameData.votes).length === vivants.length) {
        clearInterval(room.gameData.timer);
        traiterResultatVote(room);
    }
  });

  socket.on('guess_white', (mot) => {
    const j = joueurs[socket.id];
    const room = rooms[j.room];
    if (!room || room.gameData.phase !== 'white_guess') return;
    room.lastAction = Date.now();
    
    if (mot.trim().toLowerCase() === room.gameData.motCivil.toLowerCase()) {
        finirPartie(room, 'Mr. White');
    } else {
        io.to(room.code).emit('info', `❌ Raté ! Le mot était "${room.gameData.motCivil}".`);
        eliminerJoueur(room, socket.id);
    }
  });

  socket.on('disconnect', () => { gererDepart(socket); });
});

// --- FONCTIONS ---

function gererDepart(socket) {
    const j = joueurs[socket.id];
    if (j) {
        const room = rooms[j.room];
        if (room) {
            socket.leave(room.code);
            room.joueurs = room.joueurs.filter(p => p.id !== socket.id);
            if (room.joueurs.length === 0) delete rooms[j.room];
            else {
                if (room.hostId === socket.id) {
                    room.hostId = room.joueurs[0].id;
                    io.to(room.joueurs[0].id).emit('tu_es_host');
                }
                envoyerEtatRoom(room);
            }
        }
        delete joueurs[socket.id];
        io.emit('update_room_list', getPublicRooms());
    }
}

function rejoindreLaSalle(socket, pseudo, code) {
    const room = rooms[code];
    socket.join(code);
    const newPlayer = { id: socket.id, pseudo: pseudo, avatarColor: Math.floor(Math.random()*16777215).toString(16) };
    room.joueurs.push(newPlayer);
    room.lastAction = Date.now();
    joueurs[socket.id] = { room: code, pseudo: pseudo };
    socket.emit('room_rejoined', { code: code, isHost: (room.hostId === socket.id), settings: room.settings });
    io.emit('update_room_list', getPublicRooms());
    envoyerEtatRoom(room);
}

function lancerTour(room) {
    const vivants = room.joueurs.filter(p => p.vivant);
    const joueurActuel = vivants[room.gameData.indexJoueurActuel];
    envoyerEtatRoom(room);
    io.to(room.code).emit('nouveau_tour', { pseudo: joueurActuel.pseudo, id: joueurActuel.id, duree: room.settings.timeWord });
    let timeLeft = room.settings.timeWord;
    room.gameData.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(room.gameData.timer);
            joueurActuel.motEcrit = "😴"; 
            room.gameData.indexJoueurActuel++;
            checkFinTour(room);
        }
    }, 1000);
}

function checkFinTour(room) {
    const vivants = room.joueurs.filter(p => p.vivant);
    envoyerEtatRoom(room);
    if (room.gameData.indexJoueurActuel >= vivants.length) {
        setTimeout(() => { lancerVote(room); }, 3000);
    } else {
        lancerTour(room);
    }
}

function lancerVote(room) {
    room.gameData.phase = 'vote';
    const vivants = room.joueurs.filter(p => p.vivant);
    io.to(room.code).emit('phase_vote', { vivants: vivants, duree: room.settings.timeVote });
    let timeLeft = room.settings.timeVote;
    room.gameData.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(room.gameData.timer);
            traiterResultatVote(room);
        }
    }, 1000);
}

function traiterResultatVote(room) {
    let counts = {};
    for (let v in room.gameData.votes) {
        const cible = room.gameData.votes[v];
        counts[cible] = (counts[cible] || 0) + 1;
    }
    let elimineId = null, max = -1;
    for (let id in counts) {
        if (counts[id] > max) { max = counts[id]; elimineId = id; }
    }
    if (!elimineId) {
        io.to(room.code).emit('info', "Égalité. Personne n'est éliminé.");
        nextRound(room);
        return;
    }
    const jElimine = room.joueurs.find(p => p.id === elimineId);
    
    // Si c'est Mr White qui est voté, il a sa chance
    if (jElimine.role === 'Mr. White') {
        room.gameData.phase = 'white_guess';
        io.to(room.code).emit('mr_white_chance', { id: elimineId, pseudo: jElimine.pseudo });
    } else {
        eliminerJoueur(room, elimineId);
    }
}

// --- LOGIQUE D'ÉLIMINATION AVANCÉE ---
function eliminerJoueur(room, id) {
    const p = room.joueurs.find(j => j.id === id);
    p.vivant = false;
    io.to(room.code).emit('joueur_elimine', { pseudo: p.pseudo, role: p.role });

    const vivants = room.joueurs.filter(p => p.vivant);
    const nbCivils = vivants.filter(p => p.role === 'Civil').length;
    const nbUnder = vivants.filter(p => p.role === 'Undercover').length;
    const nbWhite = vivants.filter(p => p.role === 'Mr. White').length;

    // 1. S'il ne reste QUE des gentils -> VICTOIRE CIVILS
    if (nbUnder === 0 && nbWhite === 0) {
        finirPartie(room, 'Civils');
        return;
    }

    // 2. CAS DUEL FINAL AVEC MR WHITE (1v1)
    // Si on est dans une situation où il reste (1 White + 1 Civil) OU (1 White + 1 Undercover)
    if (nbWhite === 1 && (nbCivils + nbUnder === 1)) {
         const whitePlayer = vivants.find(p => p.role === 'Mr. White');
         
         // Au lieu de refaire un tour de parole inutile, on force Mr White à deviner
         room.gameData.phase = 'white_guess';
         io.to(room.code).emit('info', "DUEL FINAL ! Mr. White doit deviner le mot maintenant.");
         io.to(room.code).emit('mr_white_chance', { id: whitePlayer.id, pseudo: whitePlayer.pseudo });
         return;
    }

    // 3. Si Mr White est mort, on vérifie la domination classique des Undercovers
    if (nbWhite === 0 && nbUnder >= nbCivils) {
        finirPartie(room, 'Imposteurs');
        return;
    }

    // 4. Sinon, le jeu continue (il y a encore du suspens)
    nextRound(room);
}

function finirPartie(room, equipeGagnante) {
    const resume = {
        gagnant: equipeGagnante,
        motCivil: room.gameData.motCivil,
        motUndercover: room.joueurs.find(p => p.role === 'Undercover')?.motSecret || "Aucun",
        joueurs: room.joueurs.map(p => ({
            pseudo: p.pseudo,
            role: p.role,
            mot: (p.role === 'Mr. White' ? "Aucun" : p.motSecret),
            vivant: p.vivant
        }))
    };
    io.to(room.code).emit('game_over', resume);
    room.status = 'waiting';
    room.gameData = {};
    room.lastAction = Date.now();
    io.emit('update_room_list', getPublicRooms());
}

function nextRound(room) {
    room.gameData.indexJoueurActuel = 0;
    room.gameData.votes = {};
    room.gameData.phase = 'tour';
    room.joueurs.forEach(p => p.motEcrit = "");
    setTimeout(() => lancerTour(room), 3000);
}

function envoyerEtatRoom(room) { io.to(room.code).emit('update_plateau', { joueurs: room.joueurs }); }

function getPublicRooms() {
    const list = [];
    for (const code in rooms) {
        if (rooms[code].status === 'waiting') {
            const pseudos = rooms[code].joueurs.map(j => j.pseudo);
            list.push({ code: code, nb: rooms[code].joueurs.length, players: pseudos, hasWhite: rooms[code].settings.hasWhite });
        }
    }
    return list;
}

setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; 
    let changed = false;
    for (const code in rooms) {
        if (now - rooms[code].lastAction > timeout) { delete rooms[code]; changed = true; }
    }
    if (changed) io.emit('update_room_list', getPublicRooms());
}, 60 * 1000); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVEUR LANCÉ sur le port ${PORT}`); });
