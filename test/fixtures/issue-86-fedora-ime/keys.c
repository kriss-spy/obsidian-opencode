#include <linux/uinput.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
void event(int fd,int code,int value){struct input_event e={0};e.type=EV_KEY;e.code=code;e.value=value;write(fd,&e,sizeof(e));e.type=EV_SYN;e.code=SYN_REPORT;e.value=0;write(fd,&e,sizeof(e));}
int main(int argc,char**argv){int fd=open("/dev/uinput",O_WRONLY|O_NONBLOCK);if(fd<0){perror("uinput");return 1;}ioctl(fd,UI_SET_EVBIT,EV_KEY);for(int k=1;k<256;k++)ioctl(fd,UI_SET_KEYBIT,k);struct uinput_user_dev d={0};strcpy(d.name,"Issue86 reproduction keyboard");d.id.bustype=BUS_USB;d.id.vendor=0x1234;d.id.product=0x86;write(fd,&d,sizeof(d));if(ioctl(fd,UI_DEV_CREATE)<0){perror("create");return 1;}usleep(700000);for(int i=1;i<argc;i++){int k=atoi(argv[i]);event(fd,abs(k),k>0);usleep(100000);}usleep(500000);ioctl(fd,UI_DEV_DESTROY);close(fd);}
