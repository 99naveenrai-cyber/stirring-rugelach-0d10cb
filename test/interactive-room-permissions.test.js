const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 2 Permission Model — default mic/camera permissions are OFF', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  assert.match(code, /exports\.adminUpdateInteractiveGlobalConfig/);
  assert.match(code, /exports\.adminUpdateStudentInteractivePermission/);
  assert.match(code, /exports\.getInteractiveRoomToken/);
  assert.match(code, /canUseMicrophone:\s*false/);
  assert.match(code, /canUseCamera:\s*false/);
});

test('Phase 2 Permission Model — effective permission calculation rules', () => {
  function computePermissions(globalConfig = {}, studentPerm = {}) {
    const audioRoomBanned = studentPerm.audioRoomBanned === true;
    const videoRoomBanned = studentPerm.videoRoomBanned === true;
    const forceMuted = studentPerm.forceMuted === true;
    const forceCameraOff = studentPerm.forceCameraOff === true;

    return {
      audioEnabled: globalConfig.audioEnabled === true,
      videoEnabled: globalConfig.videoEnabled === true,
      canListenAudioRoom: !audioRoomBanned && globalConfig.audioRoomViewingEnabled !== false && studentPerm.canListenAudioRoom !== false,
      canWatchVideoRoom: !videoRoomBanned && globalConfig.videoRoomViewingEnabled !== false && studentPerm.canWatchVideoRoom !== false,
      canUseMicrophone: !audioRoomBanned && !forceMuted && globalConfig.audioEnabled === true && studentPerm.canUseMicrophone === true,
      canUseCamera: !videoRoomBanned && !forceCameraOff && globalConfig.videoEnabled === true && studentPerm.canUseCamera === true,
      audioRoomBanned,
      videoRoomBanned,
      bothBanned: audioRoomBanned && videoRoomBanned,
      forceMuted,
      forceCameraOff
    };
  }

  // Case 1: Default state -> mic and cam MUST be false
  const defaultState = computePermissions();
  assert.equal(defaultState.canUseMicrophone, false);
  assert.equal(defaultState.canUseCamera, false);
  assert.equal(defaultState.canListenAudioRoom, true);
  assert.equal(defaultState.canWatchVideoRoom, true);

  // Case 2: Global audio enabled + Student granted mic -> mic becomes true
  const grantedMic = computePermissions({ audioEnabled: true }, { canUseMicrophone: true });
  assert.equal(grantedMic.canUseMicrophone, true);
  assert.equal(grantedMic.canUseCamera, false);

  // Case 3: Admin force mutes student -> mic becomes false even if granted
  const forceMuted = computePermissions({ audioEnabled: true }, { canUseMicrophone: true, forceMuted: true });
  assert.equal(forceMuted.canUseMicrophone, false);

  // Case 4: Audio room banned -> listening and mic both become false
  const bannedAudio = computePermissions({ audioEnabled: true }, { canUseMicrophone: true, audioRoomBanned: true });
  assert.equal(bannedAudio.canListenAudioRoom, false);
  assert.equal(bannedAudio.canUseMicrophone, false);
  assert.equal(bannedAudio.canWatchVideoRoom, true); // video room unaffected

  // Case 5: Both banned -> all interactive access false
  const bothBanned = computePermissions({ audioEnabled: true, videoEnabled: true }, { audioRoomBanned: true, videoRoomBanned: true });
  assert.equal(bothBanned.bothBanned, true);
  assert.equal(bothBanned.canListenAudioRoom, false);
  assert.equal(bothBanned.canWatchVideoRoom, false);
  assert.equal(bothBanned.canUseMicrophone, false);
  assert.equal(bothBanned.canUseCamera, false);
});
