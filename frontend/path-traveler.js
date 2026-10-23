// Approved prototype artwork, shared by route, equipment preview, share card and profile.
function pathTravelerArtwork(gear = 'hat') {
  return `<g class="traveler-art gear-${gear}" fill="none">
    <ellipse class="traveler-shadow" cx="113" cy="281" rx="64" ry="7" fill="#29272b" opacity=".3"/>
    <g class="traveler-body">
      <g class="traveler-arm-back">
        <path d="m130 94 18 5 13 40-9 8-19-30Z" fill="#566767"/>
        <path d="m151 139 10-3 13 35-5 9-7-6Z" fill="#b98260"/>
        <path d="m167 171 5-2 5 7-3 8-6-2Z" fill="#c69a74"/>
      </g>
      <g class="traveler-leg-back">
        <path d="m110 165 27 5-9 49-38 39-13-9 28-43Z" fill="#84745e"/>
        <path d="m110 176 12 2-10 34-28 38" fill="none" stroke="#665d50" stroke-width="3"/>
        <path d="m78 246 15 10-3 10-14 7-22-8 1-7 16-1Z" fill="#4d4139"/>
        <path d="m55 264 22 6 14-7-1 6-15 7-22-7Z" fill="#282b2d"/>
        <path d="m74 252 11 7m-15-3 10 6" stroke="#ac9575" stroke-width="2"/>
      </g>
      <g class="traveler-pack">
        <path d="M58 80q9-14 27-10l12 7 8 75-17 17-31-7q-11-39 1-82Z" fill="#576259"/>
        <path d="M57 82q7-7 26-5l9 8-1 62-8 11-23-7Z" fill="#738070"/>
        <path d="m60 106 27 3-1 33-27-3Z" fill="#87917b"/>
        <path d="m59 107 26 2-2 10-22-2Z" fill="#a0a38b"/>
        <path d="m66 80-3 69m20-67-3 71" fill="none" stroke="#414d47" stroke-width="4"/>
        <path d="m62 115 7 1-1 7-7-1m17-5 7 1-1 7-7-1" fill="#c5b58e"/>
        <rect x="48" y="65" width="46" height="18" rx="8" fill="#9b9377" transform="rotate(8 71 74)"/>
        <ellipse cx="52" cy="72" rx="7" ry="9" fill="#6c6c5c"/>
        <ellipse cx="52" cy="72" rx="3.5" ry="5" fill="none" stroke="#b9ae8d" stroke-width="1.4"/>
        <path d="m66 65-2 16m18-14-2 17" stroke="#3f4d49" stroke-width="4"/>
        <path d="m47 123 10-1 4 29-11 3Z" fill="#9bacb1"/><path d="m48 122 7-1-1-5-6 1Z" fill="#46596a"/>
        <path d="m49 130 8-1m-7 5 8-1" stroke="#d5d9d0" stroke-width="2"/>
      </g>
      <g class="traveler-leg-front">
        <path d="m92 163 29-1 6 45 21 52-18 8-28-50-12-34Z" fill="#b19b77"/>
        <path d="m111 179 7 33 18 42" fill="none" stroke="#8f7d62" stroke-width="3"/>
        <path d="m102 187 15-2 4 19-15 3Z" fill="#a38e6c" stroke="#85775f" stroke-width="1.5"/>
        <path d="m104 190 14-2m-10 15 9-2" stroke="#cab58d" stroke-width="1.5"/>
        <path d="m129 255 18-7 7 14 18 6 1 9-32 1-11-7Z" fill="#655142"/>
        <path d="m140 274 33-1v6l-34 2-10-7v-5Z" fill="#2f3030"/>
        <path d="m142 258 10 3m-8 1 12 3m-10 1 12 3" stroke="#c6ae87" stroke-width="2"/>
      </g>
      <path d="M92 85q15-9 35 1l15 22-7 62q-20 10-44-1l-7-51Z" fill="#9baca4"/>
      <path d="m91 100 6 53 5 18-12-2-7-52Z" fill="#75877f"/>
      <path d="m119 94 10 10-4 60-6 5Z" fill="#c1c4ac"/>
      <path d="m102 105 12-2 1 22-13 1Z" fill="#83978f" stroke="#617970" stroke-width="1.2"/>
      <path d="m102 107 12-1-2 6-8 1Z" fill="#b0baaa"/><circle cx="109" cy="110" r="1" fill="#4f665f"/>
      <path d="m132 112-4 37m-30 4 11 4m14-13 8-3" fill="none" stroke="#6f847b" stroke-width="1.5"/>
      <path d="m89 166 47-1-1 8-44 1Z" fill="#534d40"/><rect x="113" y="165" width="10" height="9" rx="1" fill="#cbb990"/><rect x="116" y="167" width="4" height="5" fill="#615947"/>
      <path d="M88 79q15 2 20 18l-8 47" fill="none" stroke="#424f48" stroke-width="9" stroke-linecap="round"/>
      <path d="M89 79q13 3 16 18l-7 40" fill="none" stroke="#b9ad86" stroke-width="4" stroke-linecap="round"/>
      <rect x="99" y="113" width="10" height="7" rx="1" fill="#d9c99b" transform="rotate(10 104 116)"/>
      <g class="traveler-arm-front">
        ${gear === 'axe' ? '<path d="m116 180 2 66m-14-2 26 3-5 5" stroke="#627788" stroke-width="5" stroke-linecap="round"/>' : ''}
        <path d="M95 96q-9 0-12 12l-1 27 15 9 17-29q0-16-19-19Z" fill="#aab6a5"/>
        <path d="m82 127 20 7-5 13-18-8Z" fill="#c5c7ad"/>
        <path d="m85 139 10 5-5 21 23 10-4 10-30-11q-4-3-3-9Z" fill="#c69972"/>
        <path d="m110 173 9 2 5 7-5 6-13-5Z" fill="#dbb18a"/><path d="m116 179 4 5m-7-3 3 5" stroke="#a77b59" stroke-width="1.4"/>
        <path d="m87 147 7 3-2 7-8-3Z" fill="#34464d"/><circle cx="88" cy="152" r="3" fill="#c5d0c3"/>
      </g>
      <path d="m110 67-2 17 12 11 13-10-6-21Z" fill="#c49269"/>
      <path d="m108 80 12 11 15-7-4 13-12 6-14-13Z" fill="#475c72"/>
      <path d="m119 96 8 22 10-7-8-18" fill="#61768a"/>
      <path d="M107 37q8-11 24-6 16 5 14 21l6 10-8 5-3 13q-14 10-26-4l-8-21Z" fill="#d5a77d"/>
      <path d="m109 44 8 6-2 17 7 12-8-3-8-21Z" fill="#b17b58"/>
      <path d="M105 40q-1-17 21-17 21 2 19 22l-7-3-13-6-10 15-7 1Z" fill="#453a31"/>
      <ellipse cx="113" cy="57" rx="5" ry="7" fill="#ddb28b"/><path d="m113 55-1 5 3 1" fill="none" stroke="#ad7956" stroke-width="1.5"/>
      <path d="m130 48 9 1" stroke="#5e4434" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="135" cy="54" rx="1.8" ry="2" fill="#2f3031"/><circle cx="135.5" cy="53.4" r=".5" fill="#f6e5c8"/>
      <path d="m139 56 3 8-5 1m-6 8 8-1" fill="none" stroke="#926447" stroke-width="1.5" stroke-linecap="round"/>
      <path d="m119 70 6 8 13-1" fill="none" stroke="#7a5740" stroke-width="2" opacity=".6"/>
      ${gear === 'cap' ? '<g class="traveler-cap"><path d="M103 39q-2-24 22-25 23 1 24 26l-20 3Z" fill="#557b8a"/><path d="M124 15q15 4 16 24l-11 4-4-28Z" fill="#7296a2"/><path d="M119 38q22-5 48 8l-1 5q-26 0-41-6l-22-3 1-7Z" fill="#345563"/><path d="m130 19 3 16" fill="none" stroke="#93aeb4" stroke-width="1.5"/><circle cx="125" cy="14" r="3" fill="#345563"/></g>' : ''}
      <g class="traveler-hat"><path d="m96 33 8-22q18-8 32 2l5 25Z" fill="#b89563"/>
      <path d="m106 14 6 12 14-1 9-10q-14-8-29-1Z" fill="#d8b681"/>
      <path d="m99 27 39 3 3 9-45-4Z" fill="#635040"/>
      <path d="M80 36q18-10 67 2l15 7q-5 7-25 4l-52-3q-13-4-5-10Z" fill="#d8b784"/>
      <path d="M83 43q31-7 69 3" fill="none" stroke="#9c7954" stroke-width="2"/>
      <path d="m105 47 1 22 10 13" fill="none" stroke="#79624a" stroke-width="1.4"/></g>
      ${gear === 'helmet' ? '<g class="traveler-helmet"><path d="M98 55Q91 9 125 10q35 1 32 48l-13 25h-31Z" fill="#d4dce0" stroke="#899ba7" stroke-width="3"/><path d="M109 36q24-12 40 8l-5 24q-19 9-33-8Z" fill="#314d69" stroke="#92bcc4" stroke-width="2"/><path d="m116 38 19-2" stroke="#c6e0db" stroke-width="4"/></g>' : ''}
      ${gear === 'goggles' ? '<path d="m116 50 30 2-3 11-25-3Z" fill="#344d60" stroke="#b1d2c7" stroke-width="3"/>' : ''}
      ${gear === 'hood' ? '<path d="M97 54q-9-42 27-42 35 4 34 44l-16 33-17 6-24-14Zm18-21q-14 16-1 39l16 11 13-16 3-21Z" fill="#50667a" fill-rule="evenodd" stroke="#b2c1c2" stroke-width="4"/>' : ''}
      ${gear === 'axe' ? '<path d="M101 42q-5-28 26-29 27 2 25 28l-8 5-36-2Z" fill="#b86f45" stroke="#e2b28a" stroke-width="3"/><path d="m109 46 1 23 21 16 15-15" fill="none" stroke="#445969" stroke-width="4"/>' : ''}
      ${gear === 'cane' ? '<path d="m119 180 18 100" stroke="#674936" stroke-width="6" stroke-linecap="round"/>' : ''}
    </g>
  </g>`;
}

function detailedTraveler(sc = {}, gearForce) {
  const gear = gearForce !== undefined ? gearForce : gearOf(sc);
  const motion = sc.motion || 'walk';
  // Foot contact is y=281 in artwork; the outer scene controls world position.
  const transform = motion === 'swim' ? 'translate(-8 -2) rotate(78) scale(.14) translate(-115 -145)'
    : 'scale(.18) translate(-115 -281)';
  return `<g class="path-person pose-${motion}" data-equipment="${gear || 'hat'}"><g transform="${transform}">${pathTravelerArtwork(gear || 'hat')}</g></g>`;
}
function travelerPortrait() {
  return `<svg class="traveler-portrait" viewBox="75 0 95 103" aria-hidden="true">${pathTravelerArtwork('hat')}</svg>`;
}

