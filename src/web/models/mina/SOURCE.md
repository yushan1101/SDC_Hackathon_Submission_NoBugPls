# Mina (interviewer character)

- Character: **KPOP_Mina**, from [LKZ1999/human](https://gitee.com/LKZ1999/human) (`Assets/KPOP_Mina`), a Unity real-time digital human by LKZ, under the Apache License 2.0 (copy in `LICENSE`, as published there). Mirrored on GitHub at [LKZMuZiLi/human](https://github.com/LKZMuZiLi/human).
- Browser loading and materials adapted from HoloHuman ([OLGTX303/human-multiplatform](https://github.com/OLGTX303/human-multiplatform), `holohuman/web/src/mina.js`).

Changes made here (Apache-2.0 section 4b):
- `mina.fbx` is `SK_MINA_CASUAL_01_with_bones_in_skirt.fbx`, unchanged.
- The textures are the originals resized to 1024 px (eyes 512, teeth 256), with colour maps saved as JPEG and the hair and lash masks as greyscale+alpha PNG.
- `suit.jpg` is rebuilt from the casual outfit's base colour (`T_MINA_CASUAL_BaseColor_White.png`) on the same UV layout by `src/scripts/build_mina_suit.py`: the latex panels and trims become a neutral wool weave (tinted per garment in `js/mina.js`), and the jewellery keeps its original pixels.
