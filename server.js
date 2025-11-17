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
// 🔽 LISTES DE MOTS 🔽
// ============================================================
const listesDeMots = {
    "Général": [
        "Banane", "Fraise", "Kiwi", "Pomme", "Ananas", "Pêche", "Melon",
        "Voiture", "Camion", "Moto", "Vélo", "Trotinette", "Bus",
        "Piano", "Guitare", "Violon", "Trompette", "Flute", "Batterie",
        "Pain", "Croissant", "Brioche", "Baguette", "Sandwich"
    ],
    "Animaux": [
        "Chien", "Chat", "Lion", "Tigre", "Loup", "Ours", "Renard",
        "Aigle", "Pigeon", "Mouette", "Perroquet",
        "Requin", "Dauphin", "Baleine", "Poisson rouge"
    ],
    "Lieux": [
        "Paris", "Londres", "Madrid", "Rome", "Tokyo", "New York",
        "Plage", "Montagne", "Campagne", "Ville", "Désert",
        "École", "Université", "Bureau", "Hôpital"
    ],
    "Difficile": [
        "Amour", "Amitié", "Haine", "Jalousie",
        "Philosophie", "Psychologie", "Mathématiques",
        "Histoire", "Géographie", "Physique"
    ]
};
// ============================================================

let rooms = {}; 
let joueurs = {}; 

io.on('connection', (socket) => {
  
  socket.emit('update_room_list', getPublicRooms());

  // Créer
  socket.on('creer_room', (infos) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    
    rooms[roomCode] = {
        code: roomCode,
        hostId: socket.id,
        joueurs: [],
        status: 'waiting', 
        lastAction: Date.now(), // Pour le nettoyage auto
        settings: {
            category: "Général",
            hasUndercover: true,
            hasWhite: true,
            whiteCanStart: false,
            timeWord: 20,
            timeVote: 15
        },
        gameData: {}
    };

    rejoindreLaSalle(socket, infos.pseudo, roomCode);
  });

  // Rejoindre
  socket.on('rejoindre_room', (infos) => {
    if (rooms[infos.code]) {
        rejoindreLaSalle(socket, infos.pseudo, infos.code);
    } else {
        socket.emit('erreur', "Cette salle n'existe pas.");
    }
  });

  // Quitter
  socket.on('quitter_room', () => {
    gererDepart(socket);
  });

  // Settings
  socket.on('update_settings', (newSettings) => {
    const j = joueurs[socket.id];
    if (!j || !rooms[j.room]) return;
    const room = rooms[j.room];
    
    room.lastAction = Date.now(); // Activité détectée

    if (!newSettings.hasUndercover && !newSettings.hasWhite) newSettings.hasUndercover = true; 
    if (!listesDeMots[newSettings.category]) newSettings.category = "Général";

    if (room.hostId === socket.id) {
        room.settings = { ...room.settings, ...newSettings };
        io.to(j.room).emit('update_settings_view', room.settings);
    }
  });

  // LANCER
  socket.on('lancer_partie', () => {
    const j = joueurs[socket.id];
    const room = rooms[j.room];
    if (!j || !room || room.hostId !== socket.id) return;

    if (room.joueurs.length < 3) {
        socket.emit('erreur', "Il faut au moins 3 joueurs !");
        return;
    }

    room.lastAction = Date.now();
    room.status = 'playing';
    room.gameData = { indexJoueurActuel: 0, votes: {}, phase: 'tour', timer: null };

    const cat = room.settings.category;
    const listeChoisie = listesDeMots[cat] || listesDeMots["Général"];

    let idx1 = Math.floor(Math.random() * listeChoisie.length);
    let idx2 = Math.floor(Math.random() * listeChoisie.length);
    while (idx1 === idx2) idx2 = Math.floor(Math.random() * listeChoisie.length);
    
    const motCivil = listeChoisie[idx1];
    const motUndercover = listeChoisie[idx2];
    room.gameData.motCivil = motCivil;

    room.joueurs.forEach(p => { 
        p.role = 'Civil'; p.motSecret = motCivil; p.vivant = true; p.motEcrit = ""; 
    });

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

    room.joueurs.forEach(p => {
        io.to(p.id).emit('debut_jeu', { mot: p.motSecret, role: p.role });
    });

    io.emit('update_room_list', getPublicRooms());
    lancerTour(room);
  });

  // JEU
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

  socket.on('disconnect', () => {
    gererDepart(socket);
  });
});

// --- FONCTIONS ---
function gererDepart(socket) {
    const j = joueurs[socket.id];
    if (j) {
        const room = rooms[j.room];
        if (room) {
            socket.leave(room.code);
            room.joueurs = room.joueurs.filter(p => p.id !== socket.id);
            if (room.joueurs.length === 0) {
                delete rooms[j.room];
            } else {
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
    const newPlayer = { 
        id: socket.id, pseudo: pseudo, 
        avatarColor: Math.floor(Math.random()*16777215).toString(16)
    };
    room.joueurs.push(newPlayer);
    
    room.lastAction = Date.now(); // Mise à jour activité
    
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
    if (room.gameData.indexJoueurActuel >= vivants.length) lancerVote(room);
    else lancerTour(room);
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
    if (jElimine.role === 'Mr. White') {
        room.gameData.phase = 'white_guess';
        io.to(room.code).emit('mr_white_chance', { id: elimineId, pseudo: jElimine.pseudo });
    } else {
        eliminerJoueur(room, elimineId);
    }
}

function eliminerJoueur(room, id) {
    const p = room.joueurs.find(j => j.id === id);
    p.vivant = false;
    io.to(room.code).emit('joueur_elimine', { pseudo: p.pseudo, role: p.role });
    const vivants = room.joueurs.filter(p => p.vivant);
    const imposteurs = vivants.filter(p => p.role !== 'Civil').length;
    const civils = vivants.filter(p => p.role === 'Civil').length;
    if (imposteurs === 0) finirPartie(room, 'Civils');
    else if (imposteurs >= civils) finirPartie(room, 'Imposteurs');
    else nextRound(room);
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
    room.lastAction = Date.now(); // On reset le timer d'inactivité
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

// --- MODIFICATION ICI POUR AFFICHER LES JOUEURS ---
function getPublicRooms() {
    const list = [];
    for (const code in rooms) {
        if (rooms[code].status === 'waiting') {
            // On envoie aussi la liste des pseudos
            const pseudos = rooms[code].joueurs.map(j => j.pseudo);
            list.push({ 
                code: code, 
                nb: rooms[code].joueurs.length, 
                players: pseudos, // Ajout de la liste
                hasWhite: rooms[code].settings.hasWhite 
            });
        }
    }
    return list;
}

// --- NETTOYAGE AUTOMATIQUE DES SALLES ---
setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes
    let changed = false;

    for (const code in rooms) {
        if (now - rooms[code].lastAction > timeout) {
            console.log(`Suppression de la salle inactive : ${code}`);
            delete rooms[code];
            changed = true;
        }
    }

    if (changed) {
        io.emit('update_room_list', getPublicRooms());
    }
}, 60 * 1000); // Vérifie toutes les minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SERVEUR LANCÉ sur le port ${PORT}`);
});
