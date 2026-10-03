#!/usr/bin/env node
// FIXTURE: a child that stays alive until killed (the K1 "unreified child" leak and its K2 reified twin). No network.
setInterval(() => {}, 60_000);
