import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppPaths} from '../shared/app-path.mjs';
test('root builds preserve all existing paths',()=>{const p=createAppPaths();for(const value of ['/api/account','/assets/a.png','/#projects','/login'])assert.equal(p.path(value),value);});
test('prefixed builds keep API assets and navigation inside their product',()=>{const p=createAppPaths('/aippt/');assert.equal(p.path('/api/account'),'/aippt/api/account');assert.equal(p.path('/#projects'),'/aippt/#projects');assert.equal(p.path('/aippt/api/account'),'/aippt/api/account');assert.equal(p.strip('/aippt/'),'/');assert.equal(p.strip('/aippt/login'),'/login');assert.equal(p.strip('/aippt-other/login'),'/aippt-other/login');assert.equal(p.path('https://example.com/a'),'https://example.com/a');assert.equal(p.path('//example.com/a'),'//example.com/a');});
test('base rejects multiple segments and traversal',()=>{for(const value of ['/a/b','/../other','https://example.com','aippt'])assert.throws(()=>createAppPaths(value));});

import {compareBuildInfo} from '../shared/diagnostics.mjs';
test('declared path adapter accepts only its pinned backend and matching API and runtime',()=>{const front={appVersion:'0.2.0',gitSha:'a'.repeat(40),apiSchemaVersion:1,runtimeMode:'hosted'};const back={...front,gitSha:'b'.repeat(40)};assert.equal(compareBuildInfo(front,back,true).blocked,true);assert.equal(compareBuildInfo(front,back,true,back.gitSha).status,'adapter');assert.equal(compareBuildInfo(front,{...back,gitSha:'c'.repeat(40)},true,back.gitSha).blocked,true);assert.equal(compareBuildInfo(front,{...back,apiSchemaVersion:2},true,back.gitSha).blocked,true);assert.equal(compareBuildInfo(front,{...back,runtimeMode:'local-browser'},true,back.gitSha).blocked,true);});
