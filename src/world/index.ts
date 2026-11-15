// world 모듈 공개 API (src/CONTRACT.md "world").
// 규약 밖 참고: Building.x/z 는 바닥 사각형 중심. Tree.r 은 수관(잎) 반지름, 줄기는 Tree.box 상자.
// 무너진 건물의 잔해는 kind 'rubble', building = 그 건물 id 로 w.boxes 끝에 붙고 Building.boxes 에도 들어간다.
export { genWorld } from './gen';
export { heightAt, groundTypeAt, inWater } from './terrain';
export { floorAt, raycast, lineOfSight, collideBody, boxesNear } from './query';
export { damageBox, blastWorld } from './damage';
